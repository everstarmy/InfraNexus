package bootstrap

import (
	"slices"
	"strings"

	"infranexus/internal/domain"
)

func receivingPermissionSeeds() []permSeed {
	labels := map[string]string{"model-management:component-models": "组件模型", "model-management:device-models": "设备模型", "arrival-orders": "到货单", "receipts": "到货验收", "assets:devices": "设备实物", "assets:components": "组件实物", "asset-attachments": "资产图片", "asset-management": "资产元数据"}
	groups := map[string][]permSeed{}
	for _, route := range domain.ReceivingRoutes() {
		prefix, action, _ := strings.CutLast(route.Permission, ":")
		buttons := groups[prefix]
		index := slices.IndexFunc(buttons, func(p permSeed) bool { return p.Code == route.Permission })
		api := apiPerm(route.Method, route.Path, labels[prefix]+" "+route.Operation)
		if index < 0 {
			buttons = append(buttons, buttonPerm(route.Permission, labels[prefix]+" "+action, api))
		} else {
			buttons[index].Children = append(buttons[index].Children, api)
		}
		groups[prefix] = buttons
	}
	out := []permSeed{}
	for _, prefix := range []string{"model-management:component-models", "model-management:device-models", "arrival-orders", "receipts", "assets:devices", "assets:components", "asset-attachments", "asset-management"} {
		out = append(out, menuPerm(prefix, labels[prefix], "/"+strings.ReplaceAll(prefix, ":", "/"), "Package", groups[prefix]...))
	}
	return out
}
