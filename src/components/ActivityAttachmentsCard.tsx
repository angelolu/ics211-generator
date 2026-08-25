import React, { useState, useEffect } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import {
  Paperclip,
  Download,
  FileText,
  Image as ImageIcon,
  Table,
  FileArchive,
  File,
  Loader2,
} from 'lucide-react';
import type { Activity, ActivityAttachment } from '../api/d4h';
import {
  getActivityAttachments,
  getSynchronousActivityAttachments,
  downloadActivityAttachment,
  getActivityAttachmentPreviewBlobUrl,
  formatFileSize,
} from '../api/d4h';

interface ActivityAttachmentsCardProps {
  contextId: number;
  activity: Activity | null;
  activityType?: string;
  isLocal?: boolean;
  style?: React.CSSProperties;
}

function isAttachmentPhoto(att: ActivityAttachment, filename: string): boolean {
  const mime = (att.fileType || att.mimeType || att.contentType || '').toLowerCase();
  const name = filename.toLowerCase();
  const ext = (att.fileExt || '').toLowerCase();

  return (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name) ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
  );
}

function getFileIcon(filename?: string, mimeType?: string) {
  const name = (filename || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) {
    return { icon: ImageIcon, color: 'var(--purple-9)', bg: 'var(--purple-2)', border: 'var(--purple-4)' };
  }
  if (mime.includes('pdf') || /\.pdf$/i.test(name)) {
    return { icon: FileText, color: 'var(--red-9)', bg: 'var(--red-2)', border: 'var(--red-4)' };
  }
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime.includes('csv') ||
    /\.(xlsx?|csv|tsv)$/i.test(name)
  ) {
    return { icon: Table, color: 'var(--green-9)', bg: 'var(--green-2)', border: 'var(--green-4)' };
  }
  if (
    mime.includes('zip') ||
    mime.includes('compressed') ||
    mime.includes('tar') ||
    /\.(zip|gz|tar|rar|7z)$/i.test(name)
  ) {
    return { icon: FileArchive, color: 'var(--amber-9)', bg: 'var(--amber-2)', border: 'var(--amber-4)' };
  }
  return { icon: File, color: 'var(--navy-8)', bg: 'var(--navy-1)', border: 'var(--navy-3)' };
}

const PhotoPreviewPopoverContent: React.FC<{
  contextId: number;
  attachment: ActivityAttachment;
  filename: string;
  sizeStr: string;
}> = ({ contextId, attachment, filename, sizeStr }) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isCancelled = false;

    getActivityAttachmentPreviewBlobUrl(contextId, attachment.id, attachment.fileType || attachment.mimeType)
      .then((url) => {
        if (!isCancelled) {
          setImgUrl(url);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [contextId, attachment.id, attachment.fileType, attachment.mimeType]);

  return (
    <div
      style={{
        width: 290,
        maxWidth: '90vw',
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--slate-4)',
        boxShadow: '0 12px 32px -4px rgba(6,27,68,0.18), 0 4px 12px rgba(6,27,68,0.08)',
        padding: 10,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header with filename & size */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span
          style={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: 'var(--slate-12)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {filename}
        </span>
        {sizeStr && (
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: 'var(--slate-10)',
              background: 'var(--slate-3)',
              padding: '1px 6px',
              borderRadius: 4,
              flexShrink: 0,
            }}
          >
            {sizeStr}
          </span>
        )}
      </div>

      {/* Image Preview Container */}
      <div
        style={{
          width: '100%',
          height: 180,
          borderRadius: 8,
          background: 'var(--slate-2)',
          border: '1px solid var(--slate-3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: 'var(--slate-9)' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.75rem' }}>Loading preview…</span>
          </div>
        ) : imgUrl ? (
          <img
            src={imgUrl}
            alt={filename}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 7,
              display: 'block',
            }}
          />
        ) : (
          <div style={{ color: 'var(--slate-9)', fontSize: '0.75rem' }}>
            Preview unavailable
          </div>
        )}
      </div>
    </div>
  );
};

export const ActivityAttachmentsCard: React.FC<ActivityAttachmentsCardProps> = ({
  contextId,
  activity,
  activityType,
  isLocal = false,
  style,
}) => {
  const activityId = activity?.id;

  const [attachments, setAttachments] = useState<ActivityAttachment[]>(() => {
    if (!activityId || isLocal) return [];
    if (activity.attachments && Array.isArray(activity.attachments) && activity.attachments.length > 0) {
      return activity.attachments;
    }
    if (activity.documents && Array.isArray(activity.documents) && activity.documents.length > 0) {
      return activity.documents;
    }
    return getSynchronousActivityAttachments(activityId) || [];
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  useEffect(() => {
    let isCancelled = false;
    if (!contextId || !activityId || isLocal) {
      return;
    }

    if (activity.attachments && activity.attachments.length > 0) {
      setAttachments(activity.attachments);
      return;
    }

    const sync = getSynchronousActivityAttachments(activityId);
    if (sync) {
      setAttachments(sync);
      return;
    }

    setIsLoading(true);
    getActivityAttachments(contextId, activityId, activityType || activity.type)
      .then((res) => {
        if (!isCancelled) {
          setAttachments(res || []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [contextId, activityId, activityType, activity?.type, activity?.attachments, isLocal]);

  const handleDownload = async (att: ActivityAttachment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!contextId || !activityId || downloadingId !== null) return;

    setDownloadingId(att.id);
    try {
      await downloadActivityAttachment(contextId, activityId, att, activityType || activity?.type);
    } catch (err) {
      console.warn('Failed to download attachment:', err);
    } finally {
      setDownloadingId(null);
    }
  };

  // If no attachments and not loading, don't render the card at all
  if (!isLoading && attachments.length === 0) {
    return null;
  }

  return (
    <div className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      {/* Card Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 12,
          borderBottom: '1px solid var(--slate-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Paperclip size={18} style={{ color: 'var(--navy-7)' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
            Attachments
          </h2>
          {attachments.length > 0 && (
            <span
              style={{
                background: 'var(--slate-3)',
                border: '1px solid var(--slate-4)',
                color: 'var(--slate-11)',
                fontWeight: 700,
                fontSize: '0.6875rem',
                padding: '2px 8px',
                borderRadius: 12,
              }}
            >
              {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
            </span>
          )}
        </div>

        {isLoading && (
          <Loader2 size={15} style={{ color: 'var(--slate-8)', animation: 'spin 1s linear infinite' }} />
        )}
      </div>

      {/* Attachments Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 10,
        }}
      >
        {attachments.map((att) => {
          const ext = att.fileExt ? `.${att.fileExt.replace(/^\./, '')}` : '';
          let filename = att.title || att.filename || att.name || `Attachment #${att.id}`;
          if (ext && !filename.toLowerCase().endsWith(ext.toLowerCase())) {
            filename = `${filename}${ext}`;
          }

          const { icon: FileIconComponent, color: iconColor, bg: iconBg, border: iconBorder } = getFileIcon(
            filename,
            att.fileType || att.mimeType || att.contentType
          );
          const sizeStr = formatFileSize(att.fileSize || att.size);
          const isDownloading = downloadingId === att.id;
          const isPhoto = isAttachmentPhoto(att, filename);

          const tileContent = (
            <div
              onClick={(e) => handleDownload(att, e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--slate-1)',
                border: '1px solid var(--slate-3)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                gap: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--slate-2)';
                e.currentTarget.style.borderColor = 'var(--navy-6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--slate-1)';
                e.currentTarget.style.borderColor = 'var(--slate-3)';
              }}
              title={`Click to download ${filename}`}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                {/* File Icon Badge */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 7,
                    background: iconBg,
                    border: `1px solid ${iconBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FileIconComponent size={16} style={{ color: iconColor }} />
                </div>

                {/* File Info */}
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: 'var(--slate-12)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {filename}
                  </span>
                  {sizeStr && (
                    <span style={{ fontSize: '0.6875rem', color: 'var(--slate-9)' }}>
                      {sizeStr}
                    </span>
                  )}
                </div>
              </div>

              {/* Download Action Icon */}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => handleDownload(att, e)}
                style={{
                  width: 28,
                  height: 28,
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  flexShrink: 0,
                }}
                title={`Download ${filename}`}
              >
                {isDownloading ? (
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Download size={13} style={{ color: 'var(--slate-10)' }} />
                )}
              </button>
            </div>
          );

          if (!isPhoto) {
            return <React.Fragment key={att.id}>{tileContent}</React.Fragment>;
          }

          return (
            <HoverCard.Root key={att.id} openDelay={300} closeDelay={150}>
              <HoverCard.Trigger asChild>
                {tileContent}
              </HoverCard.Trigger>
              <HoverCard.Portal>
                <HoverCard.Content
                  className="popover-content"
                  side="top"
                  align="center"
                  sideOffset={8}
                >
                  <PhotoPreviewPopoverContent
                    contextId={contextId}
                    attachment={att}
                    filename={filename}
                    sizeStr={sizeStr}
                  />
                </HoverCard.Content>
              </HoverCard.Portal>
            </HoverCard.Root>
          );
        })}
      </div>
    </div>
  );
};
