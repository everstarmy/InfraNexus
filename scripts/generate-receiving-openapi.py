#!/usr/bin/env python3
"""Update only receiving operations/schemas from their Go registry and DTOs.

Run from any directory. Requests use explicit per-operation envelopes; domain
record schemas are responses only, so clients cannot write IDs or audit fields.
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'backend/internal/bootstrap/openapi.json'
doc = json.loads(SPEC.read_text())
schemas = doc['components']['schemas']
structs = {}
for file in [ROOT/'backend/internal/domain/receiving.go', *sorted((ROOT/'backend/internal/service').glob('receiving_*.go'))]:
    for name, body in re.findall(r'^type (\w+) struct \{\n(.*?)^\}', file.read_text(), re.M | re.S):
        structs[name] = body


def ref(name):
    return {'$ref': '#/components/schemas/Receiving' + name.split('.')[-1]}


def obj(props, required=()):
    out = {'type': 'object', 'properties': props}
    if required:
        out['required'] = list(required)
    return out


def typ(go):
    if go.startswith('*'):
        inner = typ(go[1:])
        return {'allOf': [inner], 'nullable': True} if '$ref' in inner else {**inner, 'nullable': True}
    if go.startswith('[]'):
        return {'type': 'array', 'items': typ(go[2:])}
    if go.startswith('datatypes.JSONType['):
        return typ(go[len('datatypes.JSONType['):-1])
    if go.startswith('map[string]'):
        return {'type': 'object', 'additionalProperties': typ(go[len('map[string]'):])}
    return {
        'uuid.UUID': {'type': 'string', 'format': 'uuid'},
        'time.Time': {'type': 'string', 'format': 'date-time'},
        'AssetDate': {'type': 'string', 'format': 'date'},
        'string': {'type': 'string'}, 'bool': {'type': 'boolean'},
        'int': {'type': 'integer'}, 'int64': {'type': 'integer', 'format': 'int64'},
        'float64': {'type': 'number', 'format': 'double'},
        'any': {}, 'jsontext.Value': {},
    }.get(go, ref(go))


def struct_schema(name, seen=()):
    if name in seen:
        raise ValueError(f'recursive unhandled embedding {name}')
    props, required = {}, []
    for line in structs[name].splitlines():
        line = line.strip()
        field = re.match(r'(\w+)\s+([^` ]+)\s+`([^`]+)`', line)
        if field:
            _, gotype, tags = field.groups()
            tag = re.search(r'json:"([^"]+)"', tags)
            if not tag or tag[1] == '-':
                continue
            jsonname, *flags = tag[1].split(',')
            props[jsonname] = typ(gotype)
            if 'omitempty' not in flags and 'omitzero' not in flags:
                required.append(jsonname)
        elif re.fullmatch(r'(?:domain\.)?\w+', line):
            embedded = line.split('.')[-1]
            if embedded in structs:
                result = struct_schema(embedded, (*seen, name))
                props.update(result['properties'])
                required.extend(result.get('required', []))
    return obj(props, required)

for name in structs:
    schemas['Receiving' + name] = struct_schema(name)

version = {'type': 'integer', 'format': 'int64', 'minimum': 1}
uuid = {'type': 'string', 'format': 'uuid'}
command = obj({'expected_version': version}, ['expected_version'])
reason_command = obj({'expected_version': version, 'reason': {'type': 'string', 'minLength': 1, 'maxLength': 1024}}, ['expected_version', 'reason'])

def edited(data):
    return obj({'expected_version': version, 'data': data}, ['expected_version', 'data'])


def selected(name, fields, required):
    source = schemas['Receiving' + name]['properties']
    return obj({k: source[k] for k in fields}, required)


def request(op):
    if op == 'receipt.photos.create':
        return obj({'expected_version': version, 'file': {'type': 'string', 'format': 'binary'}}, ['expected_version', 'file'])
    if op.startswith('model.'):
        component = '.component.' in op
        action = '.'.join(op.split('.')[2:])
        if action == 'create':
            fields = ['manufacturer_id', 'name', 'part_no', 'kind'] if component else ['manufacturer_id', 'name', 'model_name', 'category']
            return selected('catalogInput', fields + ['description'], fields)
        if action == 'update':
            return edited(selected('catalogNameInput', ['name', 'description'], ['name']))
        if action == 'status':
            return obj({'expected_version': version, 'status': {'type': 'integer', 'enum': [1, 2]}}, ['expected_version', 'status'])
        if action == 'revisions.create':
            return obj({'from_revision_id': {**uuid, 'nullable': True}})
        if action == 'revisions.update':
            fields = ['tracking_mode', 'unit', 'spec'] if component else ['mounting_type', 'height_u', 'rated_power_w', 'spec', 'slots', 'ports', 'standard_components', 'compatibilities']
            return edited(selected('revisionInput', fields, fields))
        return command
    if op == 'order.create':
        return selected('arrivalInput', ['name','supplier_id','external_order_no','expected_arrival_date','description'], ['name','supplier_id'])
    if op == 'order.update':
        return edited(request('order.create'))
    if op == 'order.lines.create':
        return selected('arrivalLineInput', ['expected_version','device_model_revision_id','planned_quantity','configuration_source','note'], ['expected_version','device_model_revision_id','planned_quantity','configuration_source'])
    if op == 'order.lines.update':
        return edited(ref('arrivalLineEdit'))
    if op in ('order.close', 'order.cancel', 'receipt.cancel'):
        return reason_command
    if op == 'receipt.create':
        return selected('receiptCreateInput', ['purchase_batch_id','note'], ['purchase_batch_id'])
    if op == 'receipt.update':
        return edited(obj({'note': {'type': 'string', 'maxLength': 1024}}))
    if op == 'receipt.items.create':
        return selected('receiptItemCreate', ['expected_version','purchase_line_id','serial_number','configuration_source'], ['expected_version','purchase_line_id','configuration_source'])
    if op == 'receipt.items.update':
        return edited(ref('receiptItemEdit'))
    if op == 'receipt.components.create':
        return selected('receiptPartCreate', ['expected_version','part_model_revision_id','quantity','initial_placement','location','units'], ['expected_version','part_model_revision_id','quantity','initial_placement'])
    if op == 'receipt.components.update':
        return edited(ref('receiptPartEdit'))
    if op == 'asset.components.serial':
        return obj({'expected_version': version,'serial_number': {'type':'string','minLength':1,'maxLength':128},'reason': {'type':'string','minLength':1,'maxLength':1024}}, ['expected_version','serial_number','reason'])
    return command


def page(item):
    return obj({'items': {'type':'array','items':item}, 'total':{'type':'integer'}, 'page':{'type':'integer'}, 'page_size':{'type':'integer'}}, ['items','total','page','page_size'])


def result(op):
    if op == 'metadata': return ref('receivingMetadataView')
    if op.endswith('.history'):
        return page(ref('AssetAction'))
    if op.startswith('model.'):
        if op.endswith('.references'):
            return obj({'revisions': {'type':'integer'}}, ['revisions'])
        if op.endswith('.delete'):
            return obj({'deleted': {'type':'boolean'}}, ['deleted'])
        if '.revisions.' in op:
            return page(ref('CatalogRevision')) if op.endswith('.list') else ref('revisionView')
        return page(ref('catalogView')) if op.endswith('.list') else ref('catalogView') if op.endswith('.get') else ref('CatalogModel')
    if op == 'order.lines.list': return page(ref('arrivalLineView'))
    if op == 'order.lines.create': return obj({'line':ref('ArrivalLine'),'order_version':version}, ['line','order_version'])
    if op in ('order.lines.update','order.lines.delete'): return obj({'order_version':version}, ['order_version'])
    if op.startswith('order.'):
        return page(ref('arrivalOrderView')) if op.endswith('.list') else ref('arrivalOrderView') if op.endswith('.get') else ref('ArrivalOrder')
    if op == 'receipt.preview': return ref('ReceiptPreview')
    if op in ('receipt.complete','receipt.result'): return ref('ReceiptResult')
    if op == 'receipt.result.items.list': return page(ref('receiptResultItem'))
    if op == 'receipt.items.list': return page(ref('ReceiptItem'))
    if op == 'receipt.items.get': return ref('receiptItemView')
    if op == 'receipt.components.list': return page(ref('ReceiptComponent'))
    if op == 'receipt.photos.list': return page(ref('AssetAttachment'))
    if op == 'receipt.photos.create': return {'allOf':[ref('AssetAttachment'),obj({'content_url':{'type':'string'},'receipt_version':version})]}
    if op.startswith(('receipt.items.','receipt.components.','receipt.photos.')): return ref('receiptWriteResult')
    if op.startswith('receipt.'):
        return page(ref('receiptView')) if op.endswith('.list') else ref('receiptView') if op.endswith('.get') else ref('Receipt')
    if op == 'asset.devices.list': return page(ref('AssetDevice'))
    if op == 'asset.devices.get': return {'allOf':[ref('AssetDevice'),obj({'location':ref('AssetLocation'),'baseline_id':uuid})]}
    if op == 'asset.devices.original.get': return {'allOf':[ref('ReceiptBaseline'),obj({'component_count':{'type':'integer'},'photos':{'type':'array','items':ref('AssetAttachment')}})]}
    if op == 'asset.devices.original.items.list': return page({'allOf':[ref('ReceiptBaselineItem'),obj({'current_identity':ref('AssetPart')})]})
    if op == 'asset.devices.current.get': return obj({'configuration_version':version,'component_count':{'type':'integer'},'unknown_slot_count':{'type':'integer'},'confirmed_at':{'type':'string','format':'date-time'}})
    if op == 'asset.devices.current.items.list': return page(ref('currentConfigurationItem'))
    if op == 'asset.devices.diff': return {'allOf':[page(ref('configurationDifference')),obj({'baseline_id':uuid,'configuration_version':version})]}
    if op == 'asset.components.list': return page(ref('partDetail'))
    if op == 'asset.components.get': return ref('partDetail')
    if op == 'asset.components.serial': return {'allOf':[ref('partDetail'),obj({'identity_event_id':uuid})]}
    return {'type':'object'}

registry = (ROOT/'backend/internal/domain/receiving_routes.go').read_text()
routes = re.findall(r'Method:\s*"([^"]+)", Path:\s*"([^"]+)", Operation:\s*"([^"]+)", Permission:\s*"([^"]+)"', registry)
assert len(routes) > 60
for method, path, op, permission in routes:
    path = '/api/v1' + re.sub(r':(\w+)', r'{\1}', path)
    params = [{'name':name,'in':'path','required':True,'schema':uuid} for name in re.findall(r'{(\w+)}',path)]
    if method in ('POST','PATCH','PUT'):
        params += [{'name':'Idempotency-Key','in':'header','required':method=='POST' and not op.endswith('.preview') or op=='asset.components.serial','schema':{'type':'string','maxLength':128}}]
    if method=='DELETE':
        params += [{'name':'expected_version','in':'query','required':True,'schema':version}]
    if method=='GET' and (op.endswith('.list') or op.endswith('.history') or op.endswith('.diff')):
        params += [{'name':'page','in':'query','schema':{'type':'integer','minimum':1,'default':1}}, {'name':'page_size','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':20}}]
    if method=='GET':
        filters=[]
        if op in ('model.component.list','model.device.list'): filters=['manufacturer_id','status','kind' if '.component.' in op else 'category','search']
        elif op=='order.list': filters=['state','supplier_id','search','created_from','created_to']
        elif op=='receipt.list': filters=['state','purchase_batch_id','search','created_from','created_to']
        elif op=='asset.devices.list': filters=['manufacturer_id','supplier_id','lifecycle_state','device_model_id','warehouse_id','source_receipt_id','search']
        elif op=='asset.components.list': filters=['part_model_id','source_device_id','current_device_id','warehouse_id','placement_kind','serial_status','search']
        elif op=='receipt.components.list': filters=['serial_status','kind','placement_kind']
        elif op.endswith('revisions.list'): filters=['state']
        if op.startswith('asset.devices.current.') or op=='asset.devices.diff': filters+=['expected_configuration_version']
        if op=='asset.devices.diff': filters+=['filter']
        if op=='asset.devices.original.items.list': filters+=['include_current_identity']
        params += [{'name':name,'in':'query','schema':uuid if name.endswith('_id') else {'type':'string'}} for name in filters]
    envelope=obj({'code':{'type':'integer','example':200000},'message':{'type':'string'},'data':result(op),'request_id':{'type':'string'},'timestamp':{'type':'integer','format':'int64'}}, ['code','message','data','request_id','timestamp'])
    operation={'tags':['到货验收与实物资产'],'summary':op,'operationId':op.replace('.','_'),'x-required-api-permission':'api:'+method+':'+re.sub(r'{(\w+)}',r':\1',path),'x-button-permission':permission,'parameters':params,'responses':{'200':{'description':'成功','content':{'application/json':{'schema':envelope}}}}}
    for status in ('400','401','403','404','409','500','503'):
        operation['responses'][status]={'$ref':'#/components/responses/Error'+status}
    if method not in ('GET','DELETE'):
        content='multipart/form-data' if op=='receipt.photos.create' else 'application/json'
        operation['requestBody']={'required':True,'content':{content:{'schema':request(op)}}}
    if op=='asset.attachments.content':
        operation['responses']['200']['content']={'image/png':{'schema':{'type':'string','format':'binary'}},'image/jpeg':{'schema':{'type':'string','format':'binary'}}}
    doc['paths'].setdefault(path,{})[method.lower()]=operation

# Drop implementation-only DTOs that no operation references.
used=set()
def collect(value):
    if isinstance(value,dict):
        reference=value.get('$ref','')
        if reference.startswith('#/components/schemas/'):
            name=reference.split('/')[-1]
            if name not in used:
                used.add(name)
                collect(schemas[name])
        for child in value.values(): collect(child)
    elif isinstance(value,list):
        for child in value: collect(child)
collect(doc['paths'])
for name in list(schemas):
    if name.startswith('Receiving') and name not in used:
        del schemas[name]

# Fail instead of emitting dangling schemas or an invalid registry expansion.
def visit(value):
    if isinstance(value,dict):
        reference=value.get('$ref','')
        if reference.startswith('#/components/schemas/'):
            assert reference.split('/')[-1] in schemas, reference
        for child in value.values(): visit(child)
    elif isinstance(value,list):
        for child in value: visit(child)
visit(doc)
SPEC.write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n')
print(f'Updated {len(routes)} receiving operations and their DTO schemas.')
