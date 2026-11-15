export default function TranscriptionPreview({ value, onChange, onSubmit, disabled }) {
  return <div style={{ display: 'grid', gap: 8, width: '100%' }}><label style={{ fontSize: 12, color: '#667085' }}>Review transcript before asking Minimi</label><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} /><button type="button" disabled={disabled || !value.trim()} onClick={onSubmit}>Use transcript</button></div>;
}
