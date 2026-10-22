package handler

import (
	"bufio"
	"bytes"
	"strings"
	"testing"
)

func TestWriteSSERejectsMetadataAndPayloadInjection(t *testing.T) {
	for name, testCase := range map[string]struct {
		id    string
		event string
		data  []byte
	}{
		"event newline":   {id: "1-0", event: "safe\nevent: injected", data: []byte(`{}`)},
		"id newline":      {id: "1-0\ndata: injected", event: "safe", data: []byte(`{}`)},
		"payload newline": {id: "1-0", event: "safe", data: []byte("{}\nevent: injected")},
	} {
		t.Run(name, func(t *testing.T) {
			var output bytes.Buffer
			if err := writeSSE(bufio.NewWriter(&output), testCase.id, testCase.event, testCase.data); err == nil {
				t.Fatal("writeSSE() accepted injected event data")
			}
			if strings.Contains(output.String(), "event: injected") {
				t.Fatalf("injected event reached stream: %q", output.String())
			}
		})
	}

	var output bytes.Buffer
	writer := bufio.NewWriter(&output)
	if err := writeSSE(writer, "123-0", "ldap.sync.progress", []byte(`{"completed":1}`)); err != nil {
		t.Fatalf("writeSSE() rejected valid JSON event: %v", err)
	}
	if err := writer.Flush(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "id: 123-0\nevent: ldap.sync.progress\ndata: {\"completed\":1}") {
		t.Fatalf("valid event encoding = %q", output.String())
	}
}
