// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { getReceivingError, isNetworkOrUnknownError, isVersionConflict } from "@/lib/api-error"
import { normalizeSpecPayload, toLocationInput, type SpecSchemaDTO } from "@/services/receiving-metadata"
import { formatCompatibleComponentLabel, formatRevisionTitle } from "@/services/receiving-models"
import { hasAllowedAction } from "./receiving-meta"
import { validateSpecAgainstSchema } from "./spec-schema-editor"

const memorySchema: SpecSchemaDTO = {
  schema_version: 1,
  fields: [
    { name: "schema_version", type: "integer", required: true, nullable: false, minimum: 1, maximum: 1 },
    { name: "capacity_bytes", type: "integer", required: true, nullable: false, unit: "bytes", minimum: 1 },
    {
      name: "memory_generation",
      type: "string",
      required: true,
      nullable: false,
      enum: ["DDR3", "DDR4", "DDR5"],
    },
    { name: "speed_mt_s", type: "integer", required: true, nullable: false, unit: "MT/s", minimum: 1 },
    { name: "ecc", type: "boolean", required: false, nullable: true },
  ],
}

describe("Receiving domain helpers", () => {
  it("combines RBAC permission with backend allowed_actions", () => {
    expect(hasAllowedAction(["update", "open"], "open", true)).toBe(true)
    expect(hasAllowedAction(["update", "open"], "open", false)).toBe(false)
    expect(hasAllowedAction(["update"], "open", true)).toBe(false)
    expect(hasAllowedAction(undefined, "open", true)).toBe(false)
  })

  it("extracts structured ReceivingError and version conflict metadata", () => {
    const err = {
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: 409001,
          message: "内容已被修改，请重新加载后确认",
          request_id: "req-123",
          data: {
            reason: "VERSION_CONFLICT",
            current_version: 7,
          },
        },
      },
    }
    expect(isVersionConflict(err)).toBe(true)
    expect(getReceivingError(err)?.current_version).toBe(7)
    expect(isNetworkOrUnknownError(err)).toBe(false)

    const timeoutErr = { isAxiosError: true }
    expect(isNetworkOrUnknownError(timeoutErr)).toBe(true)
  })

  it("validates and normalizes dynamic spec against metadata schema", () => {
    expect(validateSpecAgainstSchema({ schema_version: 1, memory_generation: "DDR5" }, memorySchema)).toContain(
      "容量",
    )

    const valid = {
      schema_version: 1,
      capacity_bytes: "68719476736",
      memory_generation: "DDR5",
      speed_mt_s: "4800",
      ecc: true,
    }
    expect(validateSpecAgainstSchema(valid, memorySchema)).toBeNull()
    expect(normalizeSpecPayload(valid, memorySchema)).toEqual({
      schema_version: 1,
      capacity_bytes: 68719476736,
      memory_generation: "DDR5",
      speed_mt_s: 4800,
      ecc: true,
    })
  })

  it("strips read-only fields from location payload", () => {
    expect(
      toLocationInput({
        warehouse_id: "wh-1",
        bin_id: "bin-1",
        warehouse_name: "WH-A",
        bin_name: "B-1",
        path: "WH-A/B-1",
      }),
    ).toEqual({
      warehouse_id: "wh-1",
      bin_id: "bin-1",
    })
    expect(toLocationInput(null)).toBeNull()
  })

  it("formats device revision title and compatible component labels", () => {
    expect(formatRevisionTitle({ name: "512 GB 内存 / 4 盘", revision_no: 2 })).toBe("512 GB 内存 / 4 盘 · v2")
    expect(formatRevisionTitle({ name: "  ", revision_no: 1 })).toBe("v1")
    expect(formatRevisionTitle({ revision_no: 3 })).toBe("v3")
    expect(
      formatCompatibleComponentLabel({
        part_model_id: "pm-1",
        part_model_revision_id: "pr-1",
        manufacturer_id: "m-1",
        name: "Samsung DDR5 32G",
        part_no: "M321R4GA3BB0",
        kind: "memory",
        revision_no: 2,
        spec: { schema_version: 1 },
        slot_keys: ["DIMM01"],
        allows_unassigned: false,
      }),
    ).toBe("Samsung DDR5 32G (M321R4GA3BB0) · v2")
  })
})
