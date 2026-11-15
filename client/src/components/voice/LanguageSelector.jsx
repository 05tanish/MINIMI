const languages = [['indic-auto', 'Auto detect'], ['hi-IN', 'Hindi'], ['en-IN', 'English'], ['hi-en', 'Hinglish'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'], ['mr-IN', 'Marathi'], ['pa-IN', 'Punjabi'], ['bn-IN', 'Bengali'], ['gu-IN', 'Gujarati']];

export default function LanguageSelector({ value, onChange }) {
  return <label className="language-selector" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#667085' }}>Language <select value={value} onChange={(event) => onChange(event.target.value)}>{languages.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>;
}
