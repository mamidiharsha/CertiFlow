import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { uploadBatch } from '../api/batches';
import FileUpload from '../components/FileUpload';
import DataTable from '../components/DataTable';
import LoadingSpinner from '../components/LoadingSpinner';
import toast from 'react-hot-toast';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

interface ParsedCandidate {
  name: string;
  phone: string;
  course: string;
  score: number;
}

export default function UploadBatchPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [preview, setPreview] = useState<ParsedCandidate[]>([]);
  const [uploaded, setUploaded] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: () => uploadBatch(file!, title),
    onSuccess: (data) => {
      if (data.errors && data.errors.length > 0) {
        setErrors(data.errors);
        setPreview([]);
        setUploaded(true);
      } else if (data.batch) {
        toast.success('Batch created successfully!');
        navigate(`/batches/${data.batch.id}`);
      } else {
        // Might return candidates for preview
        setPreview([]);
        setErrors([]);
        setUploaded(true);
        toast.success('Batch created successfully!');
        navigate('/batches');
      }
    },
    onError: (error: { response?: { data?: { errors?: ValidationError[] } } }) => {
      const validationErrors = error.response?.data?.errors;
      if (validationErrors && validationErrors.length > 0) {
        setErrors(validationErrors);
        setPreview([]);
        setUploaded(true);
      }
    },
  });

  const handleUpload = () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }
    if (!title.trim()) {
      toast.error('Please enter a batch title');
      return;
    }
    uploadMutation.mutate();
  };

  const errorColumns = [
    { key: 'row', header: 'Row #', render: (e: ValidationError) => <span className="font-mono font-medium text-red-600">{e.row}</span> },
    { key: 'field', header: 'Field', render: (e: ValidationError) => <span className="font-medium">{e.field}</span> },
    { key: 'message', header: 'Error', render: (e: ValidationError) => <span className="text-red-600">{e.message}</span> },
  ];

  const previewColumns = [
    { key: 'name', header: 'Name' },
    { key: 'phone', header: 'Phone' },
    { key: 'course', header: 'Course' },
    { key: 'score', header: 'Score', render: (c: ParsedCandidate) => <span className="tabular-nums">{c.score}</span> },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Batch</h1>
        <p className="text-sm text-gray-500">Upload a spreadsheet of candidates to create a new batch</p>
      </div>

      <div className="space-y-6">
        {/* Title input */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-2">Batch Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., January 2025 — Web Development Cohort"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {/* File upload */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-gray-700 mb-3">Candidate File</label>
          <FileUpload
            onFileSelect={(f) => { setFile(f); setErrors([]); setPreview([]); setUploaded(false); }}
            selectedFile={file}
            onClear={() => { setFile(null); setErrors([]); setPreview([]); setUploaded(false); }}
          />
          <p className="mt-2 text-xs text-gray-500">
            Columns: name, phone (10 digits), course, score (0–100)
          </p>
        </div>

        {/* Upload button */}
        {!uploaded && (
          <button
            onClick={handleUpload}
            disabled={!file || !title.trim() || uploadMutation.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {uploadMutation.isPending ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploadMutation.isPending ? 'Uploading…' : 'Upload & Create Batch'}
          </button>
        )}

        {/* Validation errors */}
        {errors.length > 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <h3 className="text-sm font-semibold">Validation Errors ({errors.length})</h3>
            </div>
            <DataTable<ValidationError>
              columns={errorColumns}
              data={errors}
              keyExtractor={(e) => `${e.row}-${e.field}`}
            />
            <p className="mt-3 text-sm text-gray-500">
              Please fix the errors in your file and upload again.
            </p>
            <button
              onClick={() => { setErrors([]); setFile(null); setUploaded(false); }}
              className="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Upload New File
            </button>
          </div>
        )}

        {/* Preview */}
        {preview.length > 0 && errors.length === 0 && (
          <div>
            <div className="mb-3 flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <h3 className="text-sm font-semibold">Preview ({preview.length} candidates)</h3>
            </div>
            <DataTable<ParsedCandidate>
              columns={previewColumns}
              data={preview}
              keyExtractor={(c) => `${c.name}-${c.phone}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
