package repository

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	ber "github.com/go-asn1-ber/asn1-ber"
	"infranexus/internal/domain"
)

func TestGatewayCancellationClosesEachNetworkStage(t *testing.T) {
	for _, stage := range []string{"TLS", "StartTLS", "Search"} {
		t.Run(stage, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = listener.Close() })
			entered := make(chan struct{})
			disconnected := make(chan struct{})
			serverErrors := make(chan error, 1)
			go func() {
				defer close(disconnected)
				conn, err := listener.Accept()
				if err != nil {
					serverErrors <- err
					return
				}
				defer conn.Close()
				if stage == "TLS" {
					// Read the ClientHello before announcing the stalled handshake.
					if _, err := io.ReadFull(conn, make([]byte, 5)); err != nil {
						serverErrors <- err
						return
					}
				} else {
					packet, err := ber.ReadPacket(conn)
					if err != nil {
						serverErrors <- err
						return
					}
					if stage == "Search" {
						response := ber.Encode(ber.ClassUniversal, ber.TypeConstructed, ber.TagSequence, nil, "LDAP response")
						response.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagInteger, packet.Children[0].Value, "id"))
						bind := ber.Encode(ber.ClassApplication, ber.TypeConstructed, 1, nil, "bind response")
						bind.AppendChild(ber.NewInteger(ber.ClassUniversal, ber.TypePrimitive, ber.TagEnumerated, 0, "success"))
						bind.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "matched DN"))
						bind.AppendChild(ber.NewString(ber.ClassUniversal, ber.TypePrimitive, ber.TagOctetString, "", "message"))
						response.AppendChild(bind)
						if _, err := conn.Write(response.Bytes()); err != nil {
							serverErrors <- err
							return
						}
						packet, err = ber.ReadPacket(conn)
						if err != nil {
							serverErrors <- err
							return
						}
					}
					want := ber.Tag(23)
					if stage == "Search" {
						want = 3
					}
					if len(packet.Children) < 2 || packet.Children[1].Tag != want {
						serverErrors <- errors.New("unexpected LDAP operation at cancellation barrier")
						return
					}
				}
				close(entered)
				_, _ = io.Copy(io.Discard, conn)
			}()
			cfg := &domain.LDAPConfig{ServerHost: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, BindDN: testBindDN, BaseDN: testBaseDN, UserFilter: "(objectClass=*)", TimeoutSeconds: 5, UseSSL: stage == "TLS", StartTLS: stage == "StartTLS"}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			result := make(chan error, 1)
			go func() {
				_, err := NewLDAPGateway().SearchUsers(ctx, cfg, testBindPW, nil)
				result <- err
			}()
			select {
			case <-entered:
			case err := <-serverErrors:
				t.Fatal(err)
			case <-time.After(2 * time.Second):
				t.Fatal("client never reached network barrier")
			}
			cancel()
			select {
			case err := <-result:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation error=%v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("LDAP operation ignored cancellation")
			}
			select {
			case <-disconnected:
			case <-time.After(time.Second):
				t.Fatal("cancelled LDAP connection remained open")
			}
		})
	}
}

func TestGatewayCancelledContextDoesNotDial(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, _, err = (&ldapGateway{}).connect(ctx, &domain.LDAPConfig{ServerHost: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled dial: %v", err)
	}
	if err := listener.(*net.TCPListener).SetDeadline(time.Now().Add(20 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	conn, err := listener.Accept()
	if err == nil {
		_ = conn.Close()
		t.Fatal("cancelled context still opened a connection")
	}
}
func TestGatewayTLSVerifiesCertificatesByDefault(t *testing.T) {
	server := httptest.NewTLSServer(http.NotFoundHandler())
	defer server.Close()
	cfg := &domain.LDAPConfig{ServerHost: "127.0.0.1", Port: server.Listener.Addr().(*net.TCPAddr).Port, UseSSL: true, TimeoutSeconds: 1}
	_, cleanup, err := (&ldapGateway{}).connect(t.Context(), cfg)
	if err == nil {
		cleanup()
		t.Fatal("accepted untrusted self-signed certificate")
	}
	cfg.InsecureSkipVerify = true
	_, cleanup, err = (&ldapGateway{}).connect(t.Context(), cfg)
	if err != nil {
		t.Fatalf("explicit insecure test connection failed: %v", err)
	}
	cleanup()
}
