#!/usr/bin/env python3
"""Build an isolated full stack, inject container-only faults, assert R09 bounds.
Uses only Python's standard library and Docker Compose; no deployment credentials.
"""
import argparse
import datetime
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / 'deploy/r09/compose.yaml'


class Audit:
    def __init__(self, output, scenario="all"):
        self.output = output
        self.scenario = scenario
        self.env = dict(os.environ)
        self.env["BUILDX_CONFIG"] = str(output / ".buildx")
        for key in ('DB_PASSWORD', 'ENCRYPTION_KEY', 'JWT_SECRET', 'ADMIN_PASSWORD'):
            self.env['R09_' + key] = secrets.token_urlsafe(36)
        self.project = 'infranexus-r09-' + str(os.getpid())
        self.ports = {name: int(self.env.get('R09_' + name + '_PORT', default)) for name, default in
                      [('HTTP', 18880), ('TIMEOUT', 18881), ('BLACKHOLE', 18882), ('REDIS', 16389), ('DIAGNOSTIC', 19091)]}
        self.report = {'project': self.project, 'scenario': scenario, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       'cases': [], 'samples': [], 'thresholds': {'socket_lifetime_s': 123, 'writer_recovery_s': 133,
                       'proxy_send_timeout_s': 130, 'shutdown_s': 10, 'goroutine_slack': 6, 'fd_slack': 4}}
        self.token = ''
        self.open_streams = []

    def compose(self, *args, timeout=60, input=None):
        return subprocess.run(['docker', 'compose', '-p', self.project, '-f', str(COMPOSE), '--profile', 'audit', *args],
                              env=self.env, input=input, text=True, capture_output=True, timeout=timeout, check=True).stdout.strip()

    def event(self, name, **data):
        print(json.dumps({'case': name, **data}), flush=True)
        self.report['cases'].append({'name': name, **data})

    def request(self, port, method, path, body=None, auth=True):
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        try:
            headers = {'Content-Type': 'application/json', 'Connection': 'close'}
            if auth and self.token:
                headers['Authorization'] = self.token
            conn.request(method, path, json.dumps(body) if body is not None else None, headers)
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def redis(self, *args):
        # RESP over the loopback-only port of our own disposable Redis.
        with socket.create_connection(('127.0.0.1', self.ports['REDIS']), timeout=3) as conn:
            values = [str(v).encode() for v in args]
            conn.sendall(b'*%d\r\n' % len(values) + b''.join(b'$%d\r\n' % len(v) + v + b'\r\n' for v in values))
            f = conn.makefile('rb')
            line = f.readline()
            if line.startswith(b'$'):
                size = int(line[1:]); return f.read(size).decode() if size >= 0 else None
            if line.startswith(b'-'):
                raise AssertionError('isolated Redis command failed')
            return line[1:].strip().decode()

    def publish(self, marker, blob=''):
        return self.redis('XADD', 'infranexus:events', 'MAXLEN', '~', 1000, '*', 'event', 'audit.marker',
                          'data', json.dumps({'marker': marker, 'blob': blob}), 'time', int(time.time() * 1000))

    def resources(self, label):
        status, body = self.request(self.ports['DIAGNOSTIC'], 'GET', '/resources', auth=False)
        assert status == 200
        value = json.loads(body)
        assert value['stack_complete'], 'diagnostics stack sample truncated'
        clients = self.redis('CLIENT', 'LIST')
        rows = [dict(field.split('=', 1) for field in line.split()) for line in clients.splitlines()]
        value.update(redis_clients=len(rows), redis_blocked=sum('b' in r.get('flags', '') for r in rows),
                     redis_xread=sum(r.get('cmd') == 'xread' for r in rows), label=label, elapsed=round(time.monotonic()-self.started, 3))
        value['redis_unaccounted'] = value['redis_clients'] - value['redis_pool_total'] - value['redis_pubsub_active'] - 1
        self.report['samples'].append(value)
        return value

    def eventually(self, predicate, timeout, description):
        deadline = time.monotonic() + timeout
        while True:
            result = predicate()
            if result:
                return result
            assert time.monotonic() < deadline, description
            time.sleep(.25)

    def clean(self, label, timeout=25):
        def check():
            value = self.resources(label)
            return value if (value['sse_writers'] == value['redis_readers'] == value['redis_blocked'] ==
                             value['redis_xread'] == value['app_tcp_established'] == 0 and
                             value['goroutines'] <= self.baseline['goroutines'] + 6 and
                             value['fds'] <= self.baseline['fds'] + 4 and
                             value['redis_pool_total'] <= 8 and value['redis_unaccounted'] == 0) else None
        return self.eventually(check, timeout, label + ': resources did not recover')

    def stream(self, port=None, cursor='', small=False):
        stream = Stream(self, port or self.ports['HTTP'], cursor, small)
        self.open_streams.append(stream)
        return stream

    def setup(self):
        for port in self.ports.values():
            with socket.socket() as check:
                check.bind(('127.0.0.1', port))
        build_log = self.output / 'compose-build.log'
        print('Building and starting isolated Compose stack; log: ' + str(build_log), flush=True)
        with build_log.open('w') as log:
            subprocess.run(['docker', 'compose', '-p', self.project, '-f', str(COMPOSE), '--profile', 'audit',
                            'up', '-d', '--build'], env=self.env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800)
        self.started = time.monotonic()
        def ready():
            try:
                status, _ = self.request(self.ports['HTTP'], 'GET', '/api/v1/health', auth=False)
                return status == 200
            except (OSError, http.client.HTTPException):
                return False
        self.eventually(ready, 60, 'gateway health failed')
        status, html = self.request(self.ports['HTTP'], 'GET', '/', auth=False)
        assert status == 200 and b'<div id="root"' in html, 'frontend bundle not served'
        status, body = self.request(self.ports['HTTP'], 'POST', '/api/v1/auth/token',
                                    {'username': 'admin', 'password': self.env['R09_ADMIN_PASSWORD']}, auth=False)
        assert status == 200, 'isolated bootstrap admin login failed'
        self.token = 'Bearer ' + json.loads(body)['data']['access_token']
        # Warm both HTTP and Redis paths before recording the resource baseline.
        warm = self.stream(); warm.close()
        self.baseline = self.resources('initial')
        self.baseline = self.clean('warmup', timeout=25)
        self.event('deployment', result='passed', baseline=self.baseline)

    def ordinary(self):
        recovery = []
        for i in range(5):
            stream = self.stream()
            self.eventually(lambda: self.resources('eof-active')['sse_writers'] == 1, 3, 'stream not active')
            start = time.monotonic(); stream.close()
            self.clean('eof-' + str(i), timeout=25)
            recovery.append(round(time.monotonic()-start, 3))
        self.event('client_disconnect_5_cycles', result='passed', recovery_seconds=recovery)
        stream = self.stream()
        marker = secrets.token_hex(8)
        event_id = self.publish(marker)
        event = stream.until('audit.marker')
        assert event['id'] == event_id and json.loads(event['data'])['marker'] == marker
        stream.close()
        replay = self.stream(cursor=event_id)
        assert replay.connected['id'] == event_id, 'reconnect checkpoint changed'
        next_marker = secrets.token_hex(8)
        next_id = self.publish(next_marker)
        replay.close()
        resumed = self.stream(cursor=event_id)
        event = resumed.until('audit.marker')
        assert event['id'] == next_id and json.loads(event['data'])['marker'] == next_marker
        resumed.close(); self.clean('replay')
        self.event('cursor_replay', result='passed')

    def proxy_faults(self):
        stream = self.stream(self.ports['TIMEOUT'])
        started = time.monotonic(); stream.until_closed(8)
        elapsed = time.monotonic() - started
        assert 2 <= elapsed <= 8
        self.clean('proxy-timeout')
        self.event('nginx_3s_upstream_timeout', result='passed', seconds=round(elapsed, 3))
        stream = self.stream()
        started = time.monotonic()
        self.compose('stop', '-t', '5', 'gateway')
        stream.until_closed(8)
        self.compose('up', '-d', '--no-deps', 'gateway')
        self.clean('proxy-terminated', timeout=133)
        self.event('gateway_termination', result='passed', seconds=round(time.monotonic()-started, 3))
        # A restarted gateway has a new network namespace: recreate the fault helper.
        self.compose('up', '-d', '--no-deps', '--force-recreate', 'fault')

    def redis_fault(self):
        stream = self.stream()
        self.eventually(lambda: self.resources('redis-before-pause')['redis_blocked'] >= 1, 3, 'XREAD not blocked')
        start = time.monotonic()
        self.compose('pause', 'redis')
        try:
            stream.until_closed(18)
        finally:
            self.compose('unpause', 'redis')
        elapsed = time.monotonic() - start
        self.clean('redis-recovered')
        restored = self.stream(); restored.close(); self.clean('redis-restored-stream')
        self.event('redis_unresponsive', result='passed', seconds=round(elapsed, 3))

    def blackhole_and_slow_reader(self):
        slow = self.stream(small=True)
        blackhole = self.stream(self.ports['BLACKHOLE'], small=True)
        start = time.monotonic()
        # Rules exist only in the disposable gateway's network namespace and on
        # its dedicated blackhole listener. No host firewall mutation is used.
        rule_in = ['INPUT', '-p', 'tcp', '--dport', '8082', '-j', 'DROP']
        rule_out = ['OUTPUT', '-p', 'tcp', '--sport', '8082', '-j', 'DROP']
        self.compose('exec', '-T', 'fault', 'iptables', '-I', *rule_in)
        self.compose('exec', '-T', 'fault', 'iptables', '-I', *rule_out)
        try:
            blob = 'x' * 32768
            for i in range(200):
                for j in range(5):
                    self.publish('pressure-' + str(i*5+j), blob)
                time.sleep(.05)
            queues = self.compose('exec', '-T', 'fault', 'ss', '-Htn', 'state', 'established')
            send_queues = [int(line.split()[1]) for line in queues.splitlines() if len(line.split()) > 3]
            queues_by_listener = {}
            for line in queues.splitlines():
                row = line.split()
                if len(row) >= 4:
                    port = row[2].rsplit(':', 1)[-1]
                    if port in ('8080', '8082'):
                        queues_by_listener[port] = max(queues_by_listener.get(port, 0), int(row[1]))
            assert all(queues_by_listener.get(port, 0) > 0 for port in ('8080', '8082')), 'both slow-reader and blackhole sockets must have backpressure'
            counters = self.compose('exec', '-T', 'fault', 'iptables', '-L', 'OUTPUT', '-nvx')
            drop_rows = [line.split() for line in counters.splitlines() if 'DROP' in line]
            assert drop_rows and any(int(row[0]) > 0 for row in drop_rows), 'blackhole dropped no packets'
            self.event('pressure_confirmed', send_queue_max_bytes=max(send_queues), send_queue_by_listener=queues_by_listener, published=1000,
                       payload_bytes=32768000, drop_packets=sum(int(row[0]) for row in drop_rows))
            socket_end = None
            writer_end = None
            while time.monotonic() - start < 134:
                value = self.resources('pressure-recovery')
                elapsed = time.monotonic() - start
                if value['app_tcp_established'] == 0 and socket_end is None:
                    socket_end = elapsed
                if value['sse_writers'] == value['redis_readers'] == value['redis_blocked'] == 0:
                    writer_end = elapsed
                    break
                time.sleep(1)
            assert socket_end is not None and socket_end <= 123, 'application socket lifetime exceeded 120s + margin'
            assert writer_end is not None and writer_end <= 133, 'writer or Redis reader survived its resource budget'
            self.event('slow_reader_and_tcp_blackhole', result='passed', socket_seconds=round(socket_end, 3),
                       writer_seconds=round(writer_end, 3))
        finally:
            self.compose('exec', '-T', 'fault', 'iptables', '-D', *rule_in)
            self.compose('exec', '-T', 'fault', 'iptables', '-D', *rule_out)
            slow.close(); blackhole.close()
        self.clean('after-pressure')
        marker = secrets.token_hex(8)
        resumed = self.stream()
        event_id = self.publish(marker)
        event = resumed.until('audit.marker')
        assert event['id'] == event_id
        resumed.close(); self.clean('after-pressure-reconnect')

    def shutdown(self):
        streams = [self.stream() for _ in range(5)]
        self.eventually(lambda: self.resources('shutdown-active')['sse_writers'] == 5, 5, 'shutdown streams not active')
        app_id = self.compose('ps', '-q', 'app')
        started = time.monotonic()
        subprocess.run(['docker', 'kill', '--signal=TERM', app_id], capture_output=True, check=True, timeout=5)
        exit_code = subprocess.run(['docker', 'wait', app_id], capture_output=True, text=True, check=True, timeout=12).stdout.strip()
        elapsed = time.monotonic() - started
        assert exit_code == '0' and elapsed <= 10, 'application exceeded SIGTERM shutdown budget'
        for stream in streams:
            stream.until_closed(3)
        clients = self.redis('CLIENT', 'LIST')
        rows = [line for line in clients.splitlines() if 'flags=b' in line or 'cmd=xread' in line or 'cmd=subscribe' in line]
        assert not rows, 'Redis retained application blocking/subscription connections after process exit'
        logs = self.compose('logs', '--no-color', 'app')
        assert 'Server forced to shutdown' not in logs
        self.event('sigterm_5_streams', result='passed', exit_code=0, seconds=round(elapsed, 3),
                   redis_blocking_connections=0)

    def run(self):
        try:
            self.setup()
            if self.scenario == 'all':
                self.ordinary()
            if self.scenario in ('all', 'proxy'):
                self.proxy_faults()
                self.redis_fault()
            if self.scenario in ('all', 'pressure'):
                self.blackhole_and_slow_reader()
            final = self.clean('final')
            self.event('resource_baseline', result='passed', before=self.baseline, after=final)
            self.shutdown()
            self.report['result'] = 'passed'
        except BaseException as error:
            self.report['result'] = 'failed'
            self.report['failure'] = type(error).__name__ + ': ' + str(error)
            raise
        finally:
            for stream in self.open_streams:
                stream.close()
            try:
                logs = self.compose('logs', '--no-color', timeout=20)
                for key in ('DB_PASSWORD', 'ENCRYPTION_KEY', 'JWT_SECRET', 'ADMIN_PASSWORD'):
                    assert self.env['R09_' + key] not in logs, 'generated credential appeared in logs'
                (self.output / 'services.log').write_text(logs)
            finally:
                (self.output / 'report.json').write_text(json.dumps(self.report, indent=2))
                self.compose('down', '--volumes', '--remove-orphans', timeout=60)


class Stream:
    def __init__(self, audit, port, cursor, small):
        self.connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
        self.connection.connect()
        if small:
            self.connection.sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024)
        path = '/api/v1/sse/notifications'
        if cursor:
            path += '?lastEventId=' + cursor
        self.connection.request('GET', path, headers={'Authorization': audit.token})
        self.response = self.connection.getresponse()
        assert self.response.status == 200, 'SSE connection rejected'
        self.connected = self.until('connected')
        self.closed = False

    def until(self, name):
        event = {}
        while True:
            raw = self.response.readline()
            assert raw, 'SSE closed before ' + name
            line = raw.decode().rstrip('\r\n')
            if not line:
                if event.get('event') == name:
                    return event
                event = {}
            elif ': ' in line:
                key, value = line.split(': ', 1); event[key] = value

    def until_closed(self, budget):
        start = time.monotonic()
        try:
            while self.response.read(65536):
                assert time.monotonic()-start <= budget, 'stream did not close within budget'
        except (http.client.IncompleteRead, ConnectionResetError, http.client.RemoteDisconnected):
            pass
        assert time.monotonic()-start <= budget, 'stream close exceeded budget'
        self.close()

    def close(self):
        if getattr(self, 'closed', False):
            return
        self.closed = True
        self.response.close(); self.connection.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    parser.add_argument('--scenario', choices=['all', 'proxy', 'pressure'], default='all')
    args = parser.parse_args()
    output = args.output or Path(tempfile.mkdtemp(prefix='infranexus-r09-'))
    output.mkdir(parents=True, exist_ok=True)
    Audit(output, args.scenario).run()
    print('Evidence: ' + str(output), flush=True)
