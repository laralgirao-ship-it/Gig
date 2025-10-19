import React, { useEffect, useState, useRef } from "react";
import { Platform, View, Text, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Alert, ScrollView } from "react-native";
import * as Speech from "expo-speech";
import { StatusBar } from "expo-status-bar";
import { apiSearch, apiAnswer, apiTranslate } from "./utils/api";
import router from "./assets/data/bot_config/router.json";
let Voice = null;
if (Platform.OS !== "web") { try { Voice = require("react-native-voice").default; } catch {} }
const styles = {
  container: { flex: 1, backgroundColor: "#0b1221", paddingTop: 36 },
  inner: { padding: 16, gap: 12 },
  title: { color: "white", fontSize: 22, fontWeight: "700" },
  input: { backgroundColor: "#111a33", color: "white", borderRadius: 12, padding: 12 },
  button: { backgroundColor: "#5661f6", padding: 12, borderRadius: 12, alignItems: "center" },
  btnSec: { backgroundColor: "#1c274a", padding: 12, borderRadius: 12, alignItems: "center" },
  btnText: { color: "white", fontWeight: "600" },
  card: { backgroundColor: "#101a35", padding: 12, borderRadius: 12, marginBottom: 8, borderColor:"#334155", borderWidth:1 },
  cardTitle: { color: "white", fontWeight: "700" },
  small: { color: "#cbd5e1" },
  row: { flexDirection: "row", gap: 8 },
  tag: { backgroundColor: "#1f2a52", color: "#cbd5e1", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: "hidden" },
  chip: { backgroundColor: "#1f2a52", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  chipText: { color: "white", fontWeight: "600" }
};
const EN_HELP = "What do you need? I can fetch manuals, full summaries, or specific info (e.g., T4 torque, 9-pin camera pinout).";
const EN_OPTIONS = "Would you like: (1) File only, (2) File + full summary, or (3) A specific information search?";
const EN_CHIPS = ["file","file+summary","specific-info"];
export default function App() {
  const [query, setQuery] = useState("");
  const [queryShown, setQueryShown] = useState("");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [listening, setListening] = useState(false);
  const [langMode, setLangMode] = useState("en");
  const webRecRef = useRef(null);
  useEffect(() => {
    if (Platform.OS !== "web" && Voice) {
      Voice.onSpeechResults = async (e) => { const text = e.value?.[0] || ""; await handleSubmit(text); };
      Voice.onSpeechError = () => { Alert.alert("Voice", "Speech recognition error."); setListening(false); };
      return () => { try { Voice.destroy().then(Voice.removeAllListeners); } catch {} };
    }
  }, []);
  function speakLang(text) {
    const lang = (langMode === "pt") ? "pt-BR" : "en-US";
    try { Speech.speak(text, { language: lang }); } catch {}
  }
  async function normalizeInputToEN(text) {
    if (langMode !== "pt") return text;
    const res = await apiTranslate(text, "en"); return res.translated || text;
  }
  async function translateOutIfNeeded(text) {
    if (langMode !== "pt") return text;
    const res = await apiTranslate(text, "pt"); return res.translated || text;
  }
  function classify(q) {
    const lower = q.toLowerCase();
    for (const rule of router.rules) {
      let ok = true;
      for (const cond of rule.if) {
        if (cond.includes("contains(")) {
          const token = cond.slice(cond.indexOf("(")+1, cond.lastIndexOf(")")).replace(/['"]/g,"");
          if (!lower.includes(token)) ok = false;
        }
      }
      if (ok) return { intent: rule.intent, entities: rule.entities || {}, topic: rule.topic };
    }
    return { intent: "disambiguate" };
  }
  function resolveModel(text) {
    const t = (text || "").toLowerCase();
    if (t.includes("t4") || t.includes("titan 4")) return "Titan 4";
    if (t.includes("rigmaster")) return "RigMaster 2";
    if (t.includes("millennium")) return "Millennium Plus";
    if (t.includes("duplex")) return "Duplex Pump";
    return null;
  }
  function suggestMode(text) {
    const q = (text || "").toLowerCase();
    if (q.includes("summary")) return "file+summary";
    if (q.includes("torque") || q.includes("pinout") || q.includes("pin") || q.includes("pressure") || q.includes("flow"))
      return "specific-info";
    return null;
  }
  function startListening() {
    const lang = (langMode === "pt") ? "pt-BR" : "en-US";
    if (Platform.OS === "web") {
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) throw new Error("Web Speech API not available.");
        const rec = new SR(); webRecRef.current = rec; rec.lang = lang;
        rec.onresult = async (e) => { const text = e.results[0][0].transcript; await handleSubmit(text); };
        rec.onend = () => setListening(false); setListening(true); rec.start();
      } catch (e) { Alert.alert("Voice (Web)", e.message); }
      return;
    }
    if (Voice) { try { Voice.start(lang); setListening(true); }
      catch (e) { Alert.alert("Voice", "Could not start recognition."); }
    } else { Alert.alert("Voice", "react-native-voice not available. Run `npx expo prebuild`."); }
  }
  function stopListening() { if (Platform.OS === "web") { try { webRecRef.current && webRecRef.current.stop(); } catch {} setListening(false); return; }
    if (Voice) { try { Voice.stop(); } catch {} } setListening(false); }
  async function handleManualFlow(model, modeHint, qEn) {
    const finalMode = modeHint || mode;
    if (!finalMode) { const msg = await translateOutIfNeeded(EN_OPTIONS); speakLang(msg); Alert.alert("Options", msg); return; }
    setLoading(true);
    try {
      const want_summary = finalMode === "file+summary";
      const res = await apiSearch({ query: qEn, model, mode: finalMode, want_summary });
      setList(res.candidates || []); setAnswer(null);
      if (finalMode === "file+summary" && (!res.candidates || !res.candidates.some(c => c.summary_available))) {
        const msg = await translateOutIfNeeded("Summary not available; I’ll return the file only."); speakLang(msg); setMode("file");
      }
    } catch (e) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  }
  async function handleSpecificInfo(model, qEn) {
    setLoading(true);
    try {
      const res = await apiAnswer({ query: qEn, model: model || "Titan 4", units: ["Nm","ft-lb","psi","bar","L/min","gpm","km/h","knot","m","ft"] });
      let ans = res.answer || null;
      if (ans?.pinout && langMode === "pt"){ const pinoutTranslated = []; for (const p of ans.pinout){ const t = await translateOutIfNeeded(p.signal); pinoutTranslated.push({ ...p, signal: t }); } ans = { ...ans, pinout: pinoutTranslated }; }
      if (ans?.text) ans.text = await translateOutIfNeeded(ans.text);
      setAnswer(ans);
      const srch = await apiSearch({ query: qEn, model, mode: "file", want_summary: false }); setList(srch.candidates || []);
      speakLang(ans?.text || await translateOutIfNeeded("Showing results and citations."));
    } catch (e) { Alert.alert("Error", e.message); } finally { setLoading(false); }
  }
  async function handleSubmit(textIn) {
    const raw = (textIn ?? query).trim(); if (!raw) return;
    const qEn = await normalizeInputToEN(raw);
    setQueryShown(langMode === "pt" ? `${raw}  (translated to EN: ${qEn})` : raw);
    const model = resolveModel(qEn); const modeHint = suggestMode(qEn); if (modeHint) setMode(modeHint);
    const intent = classify(qEn);
    if (intent.intent === "request_manual" || qEn.includes("manual")) {
      if (!model) { const msg = await translateOutIfNeeded("Which model manual do you want? (Titan 4, RigMaster 2, Millennium, Duplex Pump)"); speakLang(msg); Alert.alert("Model", msg); return; }
      return handleManualFlow(model, modeHint, qEn);
    }
    if (intent.intent === "request_manual_with_summary") {
      if (!model) { const msg = await translateOutIfNeeded("Which model manual do you want?"); speakLang(msg); Alert.alert("Model", msg); return; }
      setMode("file+summary"); return handleManualFlow(model, "file+summary", qEn);
    }
    if (intent.intent === "request_specific_info") { return handleSpecificInfo(model || "Titan 4", qEn); }
    const msg = await translateOutIfNeeded(EN_HELP); speakLang(msg); Alert.alert("Help", msg);
  }
  function openPath(path) {
    Alert.alert(langMode === "pt" ? "Abrir arquivo" : "Open file",
      `${langMode==="pt" ? "Caminho relativo" : "Relative path"}: ${path}
${langMode==="pt"
        ? "Hospede seus PDFs e altere esta ação para abrir a URL pública."
        : "Host your PDFs and change this to open the public URL."}`);
  }
  function ModeChips() {
    return (
      <View style={[styles.row, { flexWrap: "wrap" }]}>
        {EN_CHIPS.map(m => (
          <TouchableOpacity key={m} style={styles.chip} onPress={() => setMode(m)}>
            <Text style={styles.chipText}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.inner}>
        <Text style={styles.title}>{langMode==="pt" ? "ROV Assistente — Voz & Texto (PT modo)" : "ROV Assistant — Voice & Text (EN)"}</Text>
        <Text style={styles.small}>{langMode==="pt" ? "Posso buscar manuais, resumos completos ou informações específicas (ex.: torque do T4, pinagem da câmera 9 pinos)." : EN_HELP}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={startListening}>
            <Text style={styles.btnText}>{listening ? (langMode==="pt" ? "Ouvindo..." : "Listening...") : (langMode==="pt" ? "Falar" : "Speak")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnSec, { flex: 1 }]} onPress={()=>{ try{ if (Platform.OS==='web') { window.speechSynthesis.cancel(); } else { Speech.stop && Speech.stop(); } }catch{} }}>
            <Text style={styles.btnText}>{langMode==="pt" ? "Parar" : "Stop"}</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.row, { marginTop: 8 }]}>
          <TouchableOpacity style={[styles.chip, { backgroundColor: langMode === "en" ? "#5661f6" : "#1f2a52" }]} onPress={() => setLangMode("en")}>
            <Text style={styles.chipText}>EN mode</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, { backgroundColor: langMode === "pt" ? "#5661f6" : "#1f2a52" }]} onPress={() => setLangMode("pt")}>
            <Text style={styles.chipText}>PT mode</Text>
          </TouchableOpacity>
        </View>
        <TextInput style={styles.input} placeholder={langMode==="pt" ? "Digite aqui... (ex.: manual do T4, torque do T4, pinagem 9 pinos câmera)" : "Type here... (e.g., T4 manual, T4 torque, 9-pin camera pinout)"} placeholderTextColor="#94a3b8" value={query} onChangeText={setQuery} onSubmitEditing={() => handleSubmit()} />
        {queryShown ? <Text style={styles.small}>Query: {queryShown}</Text> : null}
        <ModeChips />
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => handleSubmit()}>
            <Text style={styles.btnText}>{langMode==="pt" ? "Buscar" : "Search"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btnSec, { flex: 1 }]} onPress={() => speakLang(langMode==="pt" ? "Como posso ajudar?" : EN_HELP)}>
            <Text style={styles.btnText}>{langMode==="pt" ? "Falar ajuda" : "Speak help"}</Text>
          </TouchableOpacity>
        </View>
        {loading && <ActivityIndicator color="#fff" />}
        {answer && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{langMode==="pt" ? "Resultado (Análise)" : "Result (Analysis)"}</Text>
            <Text style={[styles.small, { marginTop: 6 }]}>{answer.text}</Text>
            {answer?.pinout && Array.isArray(answer.pinout) && answer.pinout.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.cardTitle}>{langMode==="pt" ? "Pinagem (9 pinos — câmera)" : "Pinout (9-pin — camera)"}</Text>
                {answer.pinout.map((p, i) => (<Text key={i} style={styles.small}>{langMode==="pt" ? `• Pino ${p.pin}: ${p.signal}` : `• Pin ${p.pin}: ${p.signal}`}</Text>))}
                <View style={[styles.row, { marginTop: 8 }]}>
                  <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={async () => {
                    const phrases = answer.pinout.map(p => (langMode==="pt") ? `Pino ${p.pin}: ${p.signal}` : `Pin ${p.pin}: ${p.signal}`);
                    const header = langMode==="pt" ? "Pinagem do conector: " : "Connector pinout: "; speakLang(header + phrases.join("; ") + ".");
                  }}>
                    <Text style={styles.btnText}>{langMode==="pt" ? "Falar pinagem" : "Speak pinout"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {Array.isArray(answer.conversions) && answer.conversions.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.small}>{langMode==="pt" ? "Conversões" : "Conversions"}</Text>
                {answer.conversions.map((c, i) => (<Text key={i} style={styles.small}>• {c.kind}: {c.primary} ({c.alt})</Text>))}
              </View>
            )}
            {Array.isArray(answer.citations) && answer.citations.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.small}>{langMode==="pt" ? "Citações" : "Citations"}</Text>
                {answer.citations.slice(0, 6).map((c, i) => (<Text key={i} style={styles.small}>• {c.path} — {langMode==="pt" ? "pág." : "p."} {c.page}</Text>))}
              </View>
            )}
          </View>
        )}
        <FlatList data={list} keyExtractor={(item, idx) => item.path + idx} renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.small}>path: {item.path}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
              {(item.tags || []).map((t, i) => (<Text key={i} style={styles.tag}>#{t}</Text>))}
            </View>
            {item.summary && (<ScrollView style={{ maxHeight: 140, marginTop: 8 }}><Text style={[styles.small, { fontStyle: "italic" }]}>{item.summary}</Text></ScrollView>)}
            <View style={[styles.row, { marginTop: 8 }]}>
              <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => openPath(item.path)}>
                <Text style={styles.btnText}>{langMode==="pt" ? "Abrir" : "Open"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )} />
      </View>
    </View>
  );
}