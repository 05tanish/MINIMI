import LanguageSelector from './LanguageSelector.jsx';

export default function VoiceSettings({ language, onLanguageChange, voice, onVoiceChange }) {
  return <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><LanguageSelector value={language} onChange={onLanguageChange} /><label style={{ fontSize: 12, color: '#667085' }}>Voice <select value={voice} onChange={(event) => onVoiceChange(event.target.value)}>{['Shivani', 'Lakshmi', 'Kalpana', 'Chetana', 'Vasudha', 'Riyaa', 'Tarika', 'Avinash', 'Shubham', 'Prakash', 'Devansh', 'Yashraj', 'Harshad'].map((item) => <option key={item}>{item}</option>)}</select></label></div>;
}
