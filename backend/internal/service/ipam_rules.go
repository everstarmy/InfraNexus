package service

import (
	"context"
	"encoding/binary"
	"net/netip"
	"strings"

	"github.com/google/uuid"

	coreerrors "infranexus/internal/core/errors"
	"infranexus/internal/domain"
)

func ipv4Number(ip netip.Addr) int64 {
	octets := ip.As4()
	return int64(binary.BigEndian.Uint32(octets[:]))
}

func SubnetRule(uow domain.ManagedUnitOfWork, inventory domain.SubnetOverlapRepository, scopes domain.ManagedRepository[domain.NetworkScope], zones domain.ManagedRepository[domain.SecurityZone]) ManagedRule[domain.Subnet] {
	return func(ctx context.Context, item, old *domain.Subnet) error {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(item.CIDR))
		if err != nil || !prefix.Addr().Is4() {
			return coreerrors.ErrParamInvalid.WithMessage("需要合法的 IPv4 CIDR")
		}
		prefix = prefix.Masked()
		item.CIDR, item.PrefixLength = prefix.String(), prefix.Bits()
		item.NetworkStart = ipv4Number(prefix.Addr())
		item.NetworkEnd = item.NetworkStart + (int64(1) << uint(32-prefix.Bits())) - 1
		if item.Gateway != "" {
			ip, err := netip.ParseAddr(item.Gateway)
			if err != nil || !prefix.Contains(ip) {
				return coreerrors.ErrParamInvalid.WithMessage("网关须位于该子网")
			}
			number := ipv4Number(ip)
			if prefix.Bits() <= 30 && (number == item.NetworkStart || number == item.NetworkEnd) {
				return coreerrors.ErrParamInvalid.WithMessage("网关不能占用网络地址或广播地址")
			}
			item.Gateway = ip.String()
		}
		for i, address := range item.DNSServers {
			ip, err := netip.ParseAddr(address)
			if err != nil || ip.Zone() != "" {
				return coreerrors.ErrParamInvalid.WithMessage("DNS 地址格式无效")
			}
			item.DNSServers[i] = ip.String()
		}
		if _, err := activeManagedParent(ctx, scopes, item.NetworkScopeID); err != nil {
			return err
		}
		if _, err := activeManagedParent(ctx, zones, item.SecurityZoneID); err != nil {
			return err
		}
		id := uuid.Nil
		if old != nil {
			id = old.ID
			if old.CIDR != item.CIDR || old.NetworkScopeID != item.NetworkScopeID || old.SecurityZoneID != item.SecurityZoneID || old.IsAllocatable != item.IsAllocatable || old.Gateway != item.Gateway || old.UsageType != item.UsageType {
				if err := requireNoManagedReferences(ctx, uow, old.TableName(), old.ID, false); err != nil {
					return err
				}
			}
		}
		if item.IsAllocatable {
			overlap, err := inventory.SubnetOverlaps(ctx, item.NetworkScopeID, id, item.CIDR)
			if err != nil {
				return err
			}
			if overlap {
				return coreerrors.ErrResourceConflict.WithMessage("同地址空间内可分配子网不能重叠")
			}
		}
		return nil
	}
}
