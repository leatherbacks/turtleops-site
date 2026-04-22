'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export default function DropZone({ onFiles, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.endsWith('.csv')
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).filter((f) =>
        f.name.endsWith('.csv')
      );
      if (files.length > 0) onFiles(files);
    },
    [onFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
        transition-all duration-200
        ${dragOver
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-border-light hover:bg-surface-elevated/50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        onChange={handleChange}
        className="hidden"
      />
      <Upload className="w-10 h-10 mx-auto mb-4 text-muted" />
      <p className="text-lg font-medium mb-2">
        Drop CSV files here
      </p>
      <p className="text-sm text-muted">
        or click to browse. Supports Wildlife Computers tag exports.
      </p>
      <p className="text-xs text-muted mt-3">
        Locations.csv required. Summary, Status, and Argos files are optional but recommended.
      </p>
    </div>
  );
}
