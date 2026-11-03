package repository

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"

	ber "github.com/go-asn1-ber/asn1-ber"
	"github.com/go-ldap/ldap/v3"
	"gorm.io/datatypes"
	"infranexus/internal/domain"
)

func resultPacket(id any, tag ber.Tag, cookie []byte) *ber.Packet {
	packet := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "message")
	packet.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, id, "id"))
	result := ber.Encode(ber.ClassApplication, ber.TypeConstructed, tag, nil, "result")
	result.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, 0, "success"))
	result.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matched DN"))
	result.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "diagnostic"))
	packet.AppendChild(result)
	if cookie != nil {
		paging := ldap.NewControlPaging(500)
		paging.SetCookie(cookie)
		controls := ber.Encode(ber.ClassContext, ber.TypeConstructed, 0, nil, "controls")
		controls.AppendChild(paging.Encode())
		packet.AppendChild(controls)
	}
	return packet
}
func entryPacket(id any, username string) *ber.Packet {
	packet := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "message")
	packet.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, id, "id"))
	entry := ber.Encode(ber.ClassApplication, ber.TypeConstructed, 4, nil, "entry")
	entry.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "uid="+username+",dc=test", "dn"))
	attrs := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attributes")
	attr := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "attribute")
	attr.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "uid", "name"))
	values := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSet, nil, "values")
	values.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, username, "value"))
	attr.AppendChild(values)
	attrs.AppendChild(attr)
	entry.AppendChild(attrs)
	packet.AppendChild(entry)
	return packet
}

func TestGatewayPagingCompletesLargeDirectoryAndBoundsTotalSearch(t *testing.T) {
	for _, endless := range []bool{false, true} {
		name := "1001 users across three pages"
		if endless {
			name = "fast pages exceed total budget"
		}
		t.Run(name, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = listener.Close() })
			done := make(chan struct{})
			serverErrors := make(chan error, 1)
			var pages atomic.Int64
			go func() {
				defer close(done)
				conn, err := listener.Accept()
				if err != nil {
					serverErrors <- err
					return
				}
				defer conn.Close()
				for {
					request, err := ber.ReadPacket(conn)
					if err != nil {
						return
					}
					id, operation := request.Children[0].Value, request.Children[1].Tag
					if operation == 0 {
						if _, err := conn.Write(resultPacket(id, 1, nil).Bytes()); err != nil {
							return
						}
						continue
					}
					if operation != 3 {
						serverErrors <- fmt.Errorf("unexpected operation %d", operation)
						return
					}
					page := pages.Add(1)
					size := 500
					if endless || page == 3 {
						size = 1
					}
					for index := range size {
						if _, err := conn.Write(entryPacket(id, fmt.Sprintf("user-%d-%d", page, index)).Bytes()); err != nil {
							return
						}
					}
					cookie := []byte(fmt.Sprint(page))
					if !endless && page == 3 {
						cookie = []byte{}
					}
					if _, err := conn.Write(resultPacket(id, 5, cookie).Bytes()); err != nil {
						return
					}
				}
			}()
			cfg := &domain.LDAPConfig{ServerHost: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, BindDN: testBindDN, BaseDN: "dc=test", UserFilter: "(uid=%s)", TimeoutSeconds: 5, AttributeMapping: datatypes.NewJSONType(domain.LDAPAttributeMapping{Username: "uid"})}
			gateway := &ldapGateway{}
			budget := 3 * time.Second
			if endless {
				budget = 100 * time.Millisecond
			}
			users, err := gateway.searchUsers(t.Context(), cfg, testBindPW, nil, budget)
			if endless {
				if !errors.Is(err, context.DeadlineExceeded) || users != nil || pages.Load() < 2 {
					t.Fatalf("partial search users=%d err=%v pages=%d", len(users), err, pages.Load())
				}
			} else {
				if err != nil || len(users) != 1001 || pages.Load() != 3 {
					t.Fatalf("complete search users=%d err=%v pages=%d", len(users), err, pages.Load())
				}
				if users[0].Username != "user-1-0" || users[1000].Username != "user-3-0" {
					t.Fatal("paging lost boundary entries")
				}
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("paging connection did not close")
			}
			select {
			case err := <-serverErrors:
				t.Fatal(err)
			default:
			}
		})
	}
}
