const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// --- SECURE SUPABASE CONNECTION ---
const SUPABASE_URL = 'https://ebtcoqdfhpmjlaevinvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sJR22My1jObDNxGm770e3w_TNW279jd'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SECURE HOST LOGIN ---
app.post('/api/host/login', (req, res) => {
    const { username, pin } = req.body;
    if (username === "BenLewis1" && pin === "4070") {
        return res.json({ success: true, token: "secure_session_token_xyz123" });
    }
    return res.status(401).json({ success: false, message: "Invalid credentials" });
});

// --- LIVE LIVE COUNTER STATS ---
app.get('/api/host/stats', async (req, res) => {
    try {
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });
        const { count: scanCount } = await supabase.from('logs').select('*', { count: 'exact', head: true });
        
        return res.json({ success: true, teams: teamCount || 0, scans: scanCount || 0, clues: 0 });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// --- LIVE ACTIVITY STREAM LOGS ---
app.get('/api/host/logs', async (req, res) => {
    const { data, error } = await supabase.from('logs').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false });
    return res.json({ success: true, logs: data });
});

// --- SECURE TEAM CREATION ---
app.post('/api/team/create', async (req, res) => {
    const { teamName, pin } = req.body;
    const { data: existingTeam } = await supabase.from('teams').select('team_name').eq('team_name', teamName).single();

    if (existingTeam) return res.status(400).json({ success: false, message: "Team Name taken" });

    const { count } = await supabase.from('teams').select('*', { count: 'exact', head: true });
    const nextId = String(count + 1).padStart(3, '0');

    const { error } = await supabase.from('teams').insert([{ team_id: nextId, team_name: teamName, pin: pin }]);
    if (error) return res.status(500).json({ success: false });

    return res.json({ success: true, teamId: nextId });
});

// --- SECURE TEAM REJOIN ---
app.post('/api/team/rejoin', async (req, res) => {
    const { teamName, pin } = req.body;
    const { data: team, error } = await supabase.from('teams').select('team_id, pin').eq('team_name', teamName).single();

    if (error || !team) return res.status(404).json({ success: false, message: "Team not found" });
    if (team.pin === pin) return res.json({ success: true, teamId: team.team_id });
    
    return res.status(401).json({ success: false, message: "Invalid PIN" });
});

// --- EXCEL DOWNLOAD TEMPLATE ---
app.get('/api/host/download-template', (req, res) => {
    const headers = [["PostNo", "PostLocation", "PostDescription", "PostClue1", "PostClue2"]];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, "GameTemplate");
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=ScoutGameTemplate.xlsx');
    res.send(buf);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server securely running on port ${PORT}`));
