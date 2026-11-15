import LanguageSelector from './LanguageSelector.jsx';

export default function VoiceSettings({ language, onLanguageChange, voice, onVoiceChange, speed = 1, onSpeedChange }) {
  return (
    <div className="voice-settings-fields">
      <LanguageSelector value={language} onChange={onLanguageChange} />
      <label>Voice<select value={voice} onChange={(event) => onVoiceChange(event.target.value)}>{['Shivani', 'Lakshmi', 'Kalpana', 'Chetana', 'Vasudha', 'Riyaa', 'Tarika', 'Avinash', 'Shubham', 'Prakash', 'Devansh', 'Yashraj', 'Harshad'].map((item) => <option key={item}>{item}</option>)}</select></label>
      {onSpeedChange && <label>Speech speed<select value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}><option value="0.85">Slower</option><option value="0.95">Relaxed</option><option value="1">Normal</option><option value="1.05">Faster</option><option value="1.15">Fast</option></select></label>}
    </div>
  );
}
