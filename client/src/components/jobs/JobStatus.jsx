export default function JobStatus({ job }) {
  if (!job) return null;
  return <div role="status" style={{ fontSize: 12, color: '#667085' }}>{job.status.replaceAll('_', ' ')}{Number.isFinite(job.progress) ? ` · ${job.progress}%` : ''}{job.error?.message ? ` · ${job.error.message}` : ''}</div>;
}
