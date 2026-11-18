import LanguageSelector from './LanguageSelector.jsx';

const TTS_SPEEDS = [0.8, 1, 1.2];
export function normalizeTtsSpeed(speed) {
  const value = Number(speed);
  return TTS_SPEEDS.reduce((closest, candidate) => Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest, 1);
}

export default function VoiceSettings({ language, onLanguageChange, voice, onVoiceChange, speed = 1, onSpeedChange }) {
  return (
    <div className="voice-settings-fields">
      <LanguageSelector value={language} onChange={onLanguageChange} />
      <label>Voice<select value={voice} onChange={(event) => onVoiceChange(event.target.value)}>{['Shivani', 'Lakshmi', 'Kalpana', 'Chetana', 'Vasudha', 'Riyaa', 'Tarika', 'Avinash', 'Shubham', 'Prakash', 'Devansh', 'Yashraj', 'Harshad'].map((item) => <option key={item}>{item}</option>)}</select></label>
      {onSpeedChange && <label>Speech speed<select value={normalizeTtsSpeed(speed)} onChange={(event) => onSpeedChange(Number(event.target.value))}><option value="0.8">Slower</option><option value="1">Normal</option><option value="1.2">Faster</option></select></label>}
    </div>
  );
}
