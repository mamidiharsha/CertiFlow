import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { verifyCertificate } from '../api/certificates';
import type { Certificate } from '../types';
import { CertificateStatus } from '../types';
import { Search, Shield, CheckCircle2, XCircle, Award } from 'lucide-react';
import { format } from 'date-fns';
import { clsx } from 'clsx';

export default function VerifyPage() {
  const { certNumber: paramCertNumber } = useParams<{ certNumber?: string }>();
  const [searchInput, setSearchInput] = useState(paramCertNumber ?? '');
  const [result, setResult] = useState<{ valid: boolean; certificate?: Certificate } | null>(null);
  const [searched, setSearched] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: (num: string) => verifyCertificate(num),
    onSuccess: (data) => {
      setResult(data);
      setSearched(true);
    },
    onError: () => {
      setResult({ valid: false });
      setSearched(true);
    },
  });

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchInput.trim()) return;
    verifyMutation.mutate(searchInput.trim());
  };

  // Auto-verify if cert number in URL
  useState(() => {
    if (paramCertNumber) {
      verifyMutation.mutate(paramCertNumber);
    }
  });

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-br from-indigo-50 via-white to-blue-50 px-4 pt-20">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 shadow-lg">
          <Shield className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Certificate Verification</h1>
        <p className="mt-1 text-sm text-gray-500">CertiFlow — Government Certificate Issuance Platform</p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="w-full max-w-lg">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Enter certificate number (e.g., CERT-MH12-2025-00001)"
            className="w-full rounded-xl border border-gray-300 py-4 pl-12 pr-28 text-base shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
          <button
            type="submit"
            disabled={verifyMutation.isPending || !searchInput.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </form>

      {/* Result */}
      {searched && result && (
        <div className="mt-8 w-full max-w-lg">
          {result.valid && result.certificate ? (
            <div className={clsx(
              'rounded-xl border p-6 shadow-sm',
              result.certificate.status === CertificateStatus.ACTIVE
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            )}>
              <div className="flex items-center gap-3 mb-4">
                {result.certificate.status === CertificateStatus.ACTIVE ? (
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                ) : (
                  <XCircle className="h-8 w-8 text-red-600" />
                )}
                <div>
                  <h3 className={clsx(
                    'text-lg font-bold',
                    result.certificate.status === CertificateStatus.ACTIVE ? 'text-green-800' : 'text-red-800'
                  )}>
                    {result.certificate.status === CertificateStatus.ACTIVE
                      ? 'Valid Certificate'
                      : 'Cancelled Certificate'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Certificate #{result.certificate.certificateNumber}
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-lg bg-white/60 p-4">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Candidate</span>
                  <span className="text-sm font-medium text-gray-900">
                    {result.certificate.candidate?.name ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Course</span>
                  <span className="text-sm font-medium text-gray-900">
                    {result.certificate.candidate?.course ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Score</span>
                  <span className="text-sm font-medium text-gray-900">
                    {result.certificate.candidate?.score ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Issued On</span>
                  <span className="text-sm font-medium text-gray-900">
                    {format(new Date(result.certificate.issuedAt), 'MMMM d, yyyy')}
                  </span>
                </div>
                {result.certificate.cancelledAt && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Cancelled On</span>
                    <span className="text-sm font-medium text-red-600">
                      {format(new Date(result.certificate.cancelledAt), 'MMMM d, yyyy')}
                    </span>
                  </div>
                )}
                {result.certificate.cancelReason && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Cancel Reason</span>
                    <span className="text-sm font-medium text-red-600">
                      {result.certificate.cancelReason}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <XCircle className="h-8 w-8 text-red-600" />
                <div>
                  <h3 className="text-lg font-bold text-red-800">Certificate Not Found</h3>
                  <p className="text-sm text-red-600">
                    No certificate was found with the number "{searchInput}".
                    Please check the number and try again.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      {!searched && (
        <div className="mt-10 flex items-center gap-2 text-sm text-gray-400">
          <Award className="h-4 w-4" />
          <span>Enter a certificate number above to verify its authenticity</span>
        </div>
      )}
    </div>
  );
}
