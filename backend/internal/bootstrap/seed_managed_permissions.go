package bootstrap

func managedResourcePermissions(module, path, label string) permSeed {
	p := "/" + module + path
	key := module + ":" + path[1:]
	read := []permSeed{apiPerm("GET", p, "查询"+label), apiPerm("GET", p+"/:id", "查看"+label), apiPerm("GET", p+"/:id/references", "查看"+label+"引用")}
	history := []permSeed{apiPerm("GET", p+"/:id/history", "查看"+label+"历史")}
	var extra []permSeed
	switch p {
	case ipamPath + subnetPath:
		address := p + "/:id/addresses/:address"
		read = append(read, apiPerm("GET", p+"/:id/addresses", "查询地址池"), apiPerm("GET", address, "查看 IP 地址"))
		history = append(history, apiPerm("GET", address+"/history", "查看 IP 历史"), apiPerm("GET", address+"/conflicts", "查看地址冲突"))
		extra = append(extra,
			buttonPerm(key+":reserve", "管理人工保留地址", apiPerm("PATCH", address+"/reservation", "变更人工保留")),
			buttonPerm(key+":conflicts", "处理地址冲突",
				apiPerm("POST", address+"/conflicts", "报告地址冲突"),
				apiPerm("PATCH", address+"/conflicts/:conflictID/resolve", "解除地址冲突"),
			),
		)
	}
	actions := []permSeed{
		buttonPerm(key+":read", "查看"+label, read...),
		buttonPerm(key+":history", "查看"+label+"历史", history...),
		buttonPerm(key+":create", "新增"+label, apiPerm("POST", p, "创建"+label)),
		buttonPerm(key+":update", "编辑"+label, apiPerm("PUT", p+"/:id", "编辑"+label)),
		buttonPerm(key+":status", "启停"+label, apiPerm("PATCH", p+"/:id/status", "启停"+label)),
		buttonPerm(key+":delete", "删除"+label, apiPerm("DELETE", p+"/:id", "删除"+label)),
	}
	return menuPerm(key, label, p, "", append(actions, extra...)...)
}
