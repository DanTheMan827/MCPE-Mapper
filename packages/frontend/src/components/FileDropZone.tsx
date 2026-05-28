import React, { useCallback, useRef, useState } from 'react';

interface FileDropZoneProps {
  onFileLoad: (file: File) => void;
  onBackendConnect: (url: string) => void;
  showBackendOption?: boolean;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ onFileLoad, onBackendConnect, showBackendOption = true }) => {
  const [dragging, setDragging] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');
  const [showBackend, setShowBackend] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.mcworld') || file.name.endsWith('.zip'))) {
      onFileLoad(file);
    }
  }, [onFileLoad]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileLoad(file);
    }
  }, [onFileLoad]);

  const handleBackendSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (backendUrl.trim()) {
      onBackendConnect(backendUrl.trim());
    }
  }, [backendUrl, onBackendConnect]);

  return (
    <div
      className={`file-drop-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !showBackend && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mcworld,.zip"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {!showBackend ? (
        <>
          <h2>🗺️ MCPE Mapper</h2>
          <p>Drop a .mcworld file here or click to browse</p>
          {showBackendOption && (
            <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
              or{' '}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBackend(true);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontSize: 12,
                }}
              >
                connect to a backend server
              </button>
            </p>
          )}
        </>
      ) : (
        <form onSubmit={handleBackendSubmit} onClick={(e) => e.stopPropagation()}>
          <h2>🔌 Connect to Backend</h2>
          <p style={{ marginBottom: 16 }}>Enter the backend server URL</p>
          <input
            type="url"
            placeholder="http://localhost:3001"
            value={backendUrl}
            onChange={(e) => setBackendUrl(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid var(--panel-border)',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text-primary)',
              fontSize: 14,
              marginBottom: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              style={{
                flex: 1,
                padding: '8px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 6,
                color: '#000',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Connect
            </button>
            <button
              type="button"
              onClick={() => setShowBackend(false)}
              style={{
                padding: '8px 12px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
