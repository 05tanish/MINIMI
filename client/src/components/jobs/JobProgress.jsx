import JobStatus from './JobStatus.jsx';

export default function JobProgress({ job }) {
  if (!job) return null;
  const terminal = ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status);
  return <div style={{ display: 'grid', gap: 6, minWidth: 180 }}><progress max="100" value={job.progress || 0} /><JobStatus job={job} />{!terminal && <span style={{ fontSize: 11, color: '#667085' }}>Keep this conversation open or return later to check status.</span>}</div>;
}
