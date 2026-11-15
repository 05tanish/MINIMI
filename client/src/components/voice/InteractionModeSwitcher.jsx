export default function InteractionModeSwitcher({ mode = 'voice', onModeChange, disabled = false }) {
  return (
    <div
      role="radiogroup"
      aria-label="Interaction mode"
      className="mode-switcher"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: '#edf0ee',
        borderRadius: '24px',
        padding: '3px',
        border: '1px solid #e0e5e1'
      }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'voice'}
        disabled={disabled}
        onClick={() => onModeChange('voice')}
        className={`mode-btn ${mode === 'voice' ? 'active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: mode === 'voice' ? '#243b35' : 'transparent',
          color: mode === 'voice' ? '#eaffb7' : '#57625c',
          boxShadow: mode === 'voice' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          transition: 'all 0.15s ease'
        }}
      >
        <span aria-hidden="true">🎙</span>
        <span>Voice Mode</span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={mode === 'text'}
        disabled={disabled}
        onClick={() => onModeChange('text')}
        className={`mode-btn ${mode === 'text' ? 'active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: 600,
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: mode === 'text' ? '#243b35' : 'transparent',
          color: mode === 'text' ? '#eaffb7' : '#57625c',
          boxShadow: mode === 'text' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          transition: 'all 0.15s ease'
        }}
      >
        <span aria-hidden="true">💬</span>
        <span>Text Mode</span>
      </button>
    </div>
  );
}
