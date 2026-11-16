import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Eye, ImagePlus, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useReceivingMetadata } from "@/components/receiving/receiving-meta"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { BizCode, getErrorCode, getErrorMessage, isVersionConflict } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import {
  attachmentContentUrl,
  receiptsService,
  type AssetAttachmentDTO,
} from "@/services/receipts"

export function ReceiptPhotosPanel({
  receiptId,
  itemId,
  receiptVersion,
  canUpload,
  canDelete,
  onVersionUpdate,
  onVersionConflict,
  highlighted,
}: {
  receiptId: string
  itemId: string
  receiptVersion: number
  canUpload: boolean
  canDelete: boolean
  onVersionUpdate: (nextVersion: number) => void
  onVersionConflict: (err: unknown) => void
  highlighted?: boolean
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const metadataQuery = useReceivingMetadata()

  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [uploadPercent, setUploadPercent] = useState(0)
  const [previewPhoto, setPreviewPhoto] = useState<AssetAttachmentDTO | null>(null)

  const photosQuery = useQuery({
    queryKey: queryKeys.receiptItemPhotos(receiptId, itemId),
    queryFn: ({ signal }) => receiptsService.listPhotos(receiptId, itemId, { page: 1, page_size: 50 }, signal),
    enabled: Boolean(receiptId && itemId),
  })

  const photos = photosQuery.data?.data.items ?? []
  const maxBytes = metadataQuery.data?.data.limits.max_photo_bytes ?? 10485760
  const maxPhotos = metadataQuery.data?.data.limits.max_photos_per_item ?? 20
  const acceptedTypes = metadataQuery.data?.data.accepted_image_types ?? ["image/jpeg", "image/png"]

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    let currentVersion = receiptVersion

    for (const file of Array.from(files)) {
      if (!acceptedTypes.includes(file.type)) {
        notify.error(`文件「${file.name}」格式不受支持，仅支持 ${acceptedTypes.join(", ")}`)
        continue
      }
      if (file.size > maxBytes) {
        notify.error(`文件「${file.name}」超过大小限制（最大 ${(maxBytes / 1024 / 1024).toFixed(1)} MB）`)
        continue
      }
      if (photos.length >= maxPhotos) {
        notify.warning(`单台设备最多上传 ${maxPhotos} 张图片`)
        break
      }

      try {
        setUploadingName(file.name)
        setUploadPercent(0)
        const res = await receiptsService.uploadPhoto(
          receiptId,
          itemId,
          currentVersion,
          file,
          createIdempotencyKey("photo"),
          (pct) => setUploadPercent(pct),
        )
        currentVersion = res.data.receipt_version
        onVersionUpdate(currentVersion)
        await queryClient.invalidateQueries({ queryKey: queryKeys.receiptItemPhotos(receiptId, itemId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.receipt(receiptId) })
        notify.success(`图片「${file.name}」已上传`)
      } catch (err) {
        if (isVersionConflict(err)) {
          onVersionConflict(err)
          break
        }
        const code = getErrorCode(err)
        if (code === BizCode.PayloadTooLarge) {
          notify.error(`图片「${file.name}」超过服务端大小限制 (413)`)
        } else if (code === BizCode.UnsupportedMediaType) {
          notify.error(`图片「${file.name}」格式不被服务端接受，请使用 JPEG 或 PNG (415)`)
        } else {
          notify.error(getErrorMessage(err, `上传图片「${file.name}」失败`))
        }
      } finally {
        setUploadingName(null)
        setUploadPercent(0)
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleDelete = (photo: AssetAttachmentDTO) => {
    confirm({
      title: `删除图片「${photo.original_filename}」`,
      description: "仅验收草稿阶段允许删除验收照片。",
      confirmText: "确认删除",
      tone: "destructive",
      onConfirm: async () => {
        try {
          const res = await receiptsService.deletePhoto(receiptId, itemId, photo.id, receiptVersion)
          onVersionUpdate(res.data.receipt_version)
          await queryClient.invalidateQueries({ queryKey: queryKeys.receiptItemPhotos(receiptId, itemId) })
          await queryClient.invalidateQueries({ queryKey: queryKeys.receipt(receiptId) })
          notify.success("照片已删除")
        } catch (err) {
          if (isVersionConflict(err)) {
            onVersionConflict(err)
            return
          }
          notify.error(getErrorMessage(err, "删除照片失败"))
        }
      },
    })
  }

  return (
    <>
      <Card id="field-photos" className={highlighted ? "ring-2 ring-destructive" : undefined}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold">
                现场验收图片凭证 ({photos.length} / {maxPhotos})
              </CardTitle>
              <CardDescription className="text-xs">
                每台验收设备至少上传 1 张现场照片；支持 JPEG/PNG，单张不超过 {(maxBytes / 1024 / 1024).toFixed(0)} MB。
              </CardDescription>
            </div>
            {canUpload && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedTypes.join(",")}
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={Boolean(uploadingName)}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="mr-1.5 size-4" />
                  上传照片
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {uploadingName && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span>正在上传：{uploadingName}</span>
                <span className="font-mono">{uploadPercent}%</span>
              </div>
              <Progress value={uploadPercent} />
            </div>
          )}

          {photos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              暂无验收图片，请拍照上传设备正面/序列号标签或内部组件照片。
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="col-span-6 sm:col-span-4 md:col-span-3 rounded-lg border overflow-hidden bg-muted/20 flex flex-col"
                >
                  <div
                    className="aspect-video bg-muted cursor-pointer overflow-hidden flex items-center justify-center"
                    onClick={() => setPreviewPhoto(photo)}
                  >
                    <img
                      src={attachmentContentUrl(photo.id)}
                      alt={photo.original_filename}
                      className="h-full w-full object-cover transition-transform hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-1 px-2.5 py-1.5 text-[11px]">
                    <span className="truncate font-medium" title={photo.original_filename}>
                      {photo.original_filename}
                    </span>
                    <div className="flex items-center shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6"
                        title="查看大图"
                        onClick={() => setPreviewPhoto(photo)}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                      {canDelete && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-6 text-destructive"
                          title="删除照片"
                          onClick={() => handleDelete(photo)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(previewPhoto)} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">{previewPhoto?.original_filename}</DialogTitle>
          </DialogHeader>
          {previewPhoto && (
            <div className="max-h-[75vh] overflow-auto flex items-center justify-center rounded-md bg-muted/30 p-2">
              <img
                src={attachmentContentUrl(previewPhoto.id)}
                alt={previewPhoto.original_filename}
                className="max-h-[70vh] w-auto object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
