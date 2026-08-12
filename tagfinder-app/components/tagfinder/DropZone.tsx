'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Take whatever the user drops. File type is decided from content downstream,
 * not from the extension — Wildlife Computers and Lotek both ship .csv, the CLS
 * raw dump is .txt, and filtering here just means files vanish silently with no
 * explanation. Anything unrecognised is reported back in the file list instead.
 */
function accepted(files: FileList | File[]): File[] {
  return Array.from(files).filter((f) => f.size > 0);
}

export default function DropZone({ onFiles, disabled }: DropZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;

      const files = accepted(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = accepted(e.target.files || []);
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
        multiple
        onChange={handleChange}
        className="hidden"
      />
      <Upload className="w-10 h-10 mx-auto mb-4 text-muted" />
      <p className="text-lg font-medium mb-2">
        Drop tag files here
      </p>
      <p className="text-sm text-muted">
        or click to browse. Supports Wildlife Computers and Lotek exports.
      </p>
      <p className="text-xs text-muted mt-3">
        Needs positions: a Wildlife Computers Locations.csv, or the raw Argos file from CLS.
        Everything else is optional but improves the analysis.
      </p>
    </div>
  );
}
