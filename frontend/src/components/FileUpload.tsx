import { useCallback, useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';
import { clsx } from 'clsx';

interface FileUploadProps {
  accept?: string;
  onFileSelect: (file: File) => void;
  selectedFile?: File | null;
  onClear?: () => void;
}

export default function FileUpload({
  accept = '.xlsx,.csv',
  onFileSelect,
  selectedFile,
  onClear,
}: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  if (selectedFile) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
        <FileSpreadsheet className="h-8 w-8 text-indigo-500" />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
          <p className="text-xs text-gray-500">
            {(selectedFile.size / 1024).toFixed(1)} KB
          </p>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="rounded-lg p-1 text-gray-400 hover:bg-white hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={clsx(
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors',
        dragOver
          ? 'border-indigo-400 bg-indigo-50'
          : 'border-gray-300 bg-white hover:border-indigo-300 hover:bg-gray-50'
      )}
    >
      <Upload className={clsx('h-10 w-10', dragOver ? 'text-indigo-500' : 'text-gray-400')} />
      <p className="mt-3 text-sm font-medium text-gray-700">
        Drag and drop your file here, or <span className="text-indigo-600">browse</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">Accepts .xlsx and .csv files</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
}
