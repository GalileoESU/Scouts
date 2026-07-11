const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// --- CENTRAL DATA BRIDGE ---
const SUPABASE_URL = 'https://ebtcoqdfhpmjlaevinvp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sJR22My1jObDNxGm770e3w_TNW279jd'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- NEW DIRECT DATABASE INJECTION ROUTES (Bypasses Spreadsheet Parser Errors) ---

// Direct array insert for teams
app.post('/api/manage/inject-people-json', async (req, res) => {
    try {
        const { payload } = req.body; // Expects array of clean objects
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ success: false, message: "Invalid JSON array payload layout." });
        }
        
        // Wipe old entries clean
        await supabase.from('teams').delete().neq('group_number', 'RESET_FORCE');
        
        // Bulk insert directly into the Supabase SQL database engine
        const { error } = await supabase.from('teams').insert(payload);
        if (error) throw error;
        
        return res.json({ success: true, count: payload.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Direct array insert for waypoints/events
app.post('/api/manage/inject-event-json', async (req, res) => {
    try {
        const { payload } = req.body;
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ success: false, message: "Invalid JSON array payload layout." });
        }

        await supabase.from('events').delete().neq('code', 'RESET_FORCE');
        
        const { error } = await supabase.from('events').insert(payload);
        if (error) throw error;

        return res.json({ success: true, count: payload.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});


// --- MANAGEMENT & STAFF AUTHENTICATION ENDPOINTS ---
app.post('/api/manage/login', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const { data, error } = await supabase.from('staff_accounts')
            .select('*').eq('username', String(username).trim()).eq('pin', String(pin).trim()).maybeSingle();
        
        if (error || !data) {
            return res.status(401).json({ success: false, message: "Invalid Management credentials." });
        }
        return res.json({ success: true, user: data.username });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/manage/users/add', async (req, res) => {
    const { username, pin } = req.body;
    try {
        const { error } = await supabase.from('staff_accounts').insert([{ username: String(username).trim(), pin: String(pin).trim() }]);
        if (error) return res.status(400).json({ success: false, message: "Username already exists." });
        return res.json({ success: true });
    } catch (err) { return res.status(500).json({ success: false }); }
});

app.get('/api/manage/users/list', async (req, res) => {
    const { data } = await supabase.from('staff_accounts').select('username').order('created_at', { ascending: true });
    return res.json({ success: true, users: data || [] });
});

app.post('/api/manage/users/delete', async (req, res) => {
    const { username } = req.body;
    if (username === 'BenLewis1') return res.status(400).json({ success: false, message: "Cannot remove Master account." });
    await supabase.from('staff_accounts').delete().eq('username', username);
    return res.json({ success: true });
});

app.post('/api/manage/users/clear-all', async (req, res) => {
    await supabase.from('staff_accounts').delete().neq('username', 'BenLewis1');
    return res.json({ success: true });
});

// --- LEGACY SPREADSHEET PARSERS (Kept for backwards compatibility) ---
app.post('/api/manage/upload-people', upload.single('peopleFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Missing file payload." });
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const formatted = rows.map(r => ({
            group_number: String(r['Group Number'] || r['group_number'] || '').trim(),
            scout_group: String(r['Group Scout Group'] || r['Scout Group'] || r['scout_group'] || '').trim(),
            category: String(r['Group Category'] || r['Category'] || r['category'] || 'Scout').trim(),
            no_of_people: parseInt(r['No of People'] || r['no_of_people'] || 1),
            youngest_age: r['Youngest Age'] ? parseInt(r['Youngest Age']) : null,
            oldest_age: r['Oldest Age'] ? parseInt(r['Oldest Age']) : null
        })).filter(r => r.group_number !== '');

        await supabase.from('teams').delete().neq('group_number', 'RESET_FORCE');
        const { error } = await supabase.from('teams').insert(formatted);
        if (error) throw error;
        return res.json({ success: true, count: formatted.length });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/manage/upload-event', upload.single('eventFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Missing file payload." });
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const formatted = rows.map(r => ({
            code: String(r['Checkpoint / Waypoint No'] || r['Code'] || r['code'] || '').trim().padStart(3, '0'),
            type: String(r['Type'] || r['type'] || '').trim(),
            target_group: String(r['Group'] || r['Target Group'] || r['target_group'] || 'All').trim()
        })).filter(r => r.code !== '000' && r.code !== '');

        await supabase.from('events').delete().neq('code', 'RESET_FORCE');
        const { error } = await supabase.from('events').insert(formatted);
        if (error) throw error;
        return res.json({ success: true, count: formatted.length });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

// --- CORE CLIENT ACTION LOGIC (SCANS, CATCHES, BACKUPS) ---
app.post('/api/client/scan-waypoint', async (req, res) => {
    let { teamId, code, lat, lon } = req.body;
    try {
        // Support processing standard codes or manual fallback entries (e.g. "WP-003" -> "003")
        let cleanCode = String(code).trim().toUpperCase();
        if (cleanCode.startsWith("WP-")) {
            cleanCode = cleanCode.replace("WP-", "");
        }
        cleanCode = cleanCode.padStart(3, '0');

        const { data: ev } = await supabase.from('events').select('*').eq('code', cleanCode).eq('type', 'Waypoint').maybeSingle();
        if (!ev) return res.status(404).json({ success: false, message: `Waypoint ${cleanCode} does not exist.` });

        const { data: team } = await supabase.from('teams').select('*').eq('group_number', teamId).maybeSingle();
        if (!team) return res.status(404).json({ success: false, message: "Team record profile lost." });

        if (ev.target_group !== 'All' && !ev.target_group.toLowerCase().includes(team.category.toLowerCase())) {
            return res.status(403).json({ success: false, message: "This waypoint is not designated for your category." });
        }

        const { data: duplicated } = await supabase.from('logs').select('*')
            .eq('team_id', teamId).eq('target_id', cleanCode).eq('action_type', 'WAYPOINT').maybeSingle();
        if (duplicated) return res.status(400).json({ success: false, message: `Waypoint ${cleanCode} already claimed.` });

        const valueReward = 10;

        await supabase.from('logs').insert([{
            team_id: teamId, action_type: 'WAYPOINT', target_id: cleanCode,
            details: `Waypoint ${cleanCode} Scanned successfully.`, points_changed: valueReward,
            latitude: lat || null, longitude: lon || null
        }]);

        await supabase.from('teams').update({
            points: team.points + valueReward,
            points_gained: team.points_gained + valueReward
        }).eq('group_number', teamId);

        return res.json({ success: true, code: cleanCode, time: new Date().toLocaleTimeString() });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/client/process-passport', async (req, res) => {
    const { operatorId, scannedPassportString, currentCheckpointContext, lat, lon } = req.body;
    try {
        const teamNumMatch = scannedPassportString.match(/CHAMELEON_TEAM_(.+)/) || scannedPassportString.match(/CHAMELEON_INITIALIZE_GROUP_(.+)/);
        if (!teamNumMatch) return res.status(400).json({ success: false, message: "Invalid QR format passport asset token matched." });
        const targetTeamNum = teamNumMatch[1];

        const { data: targetTeam } = await supabase.from('teams').select('*').eq('group_number', targetTeamNum).maybeSingle();
        if (!targetTeam) return res.status(404).json({ success: false, message: "Scanned Target Team not found." });

        const { data: operatorTeam } = await supabase.from('teams').select('*').eq('group_number', operatorId).maybeSingle();

        // 1. Handle Checkpoint Check-in Logic
        if (currentCheckpointContext) {
            await supabase.from('logs').insert([{
                team_id: targetTeamNum, action_type: 'CHECKIN', target_id: currentCheckpointContext,
                details: `Signed into Checkpoint station: ${currentCheckpointContext}`,
                latitude: lat || null, longitude: lon || null
            }]);
            return res.json({ success: true, type: 'CHECKIN', message: `Group ${targetTeamNum} Signed In Successfully` });
        }

        // 2. Handle Catch Logic (Allows scores to go negative)
        if (operatorTeam && operatorTeam.category === 'Catcher') {
            const now = new Date();
            let graceRemainingMinutes = 0;

            if (targetTeam.last_caught_at) {
                const elapsedMs = now - new Date(targetTeam.last_caught_at);
                graceRemainingMinutes = 15 - (elapsedMs / 1000 / 60);
            }

            if (graceRemainingMinutes > 0) {
                await supabase.from('logs').insert([{
                    team_id: targetTeamNum, action_type: 'GRACE_BLOCK', target_id: operatorId,
                    details: `Intercepted by Catcher ${operatorId} during Active Grace period. Blocked points loss.`,
                    latitude: lat || null, longitude: lon || null
                }]);
                return res.json({ success: true, type: 'GRACE', message: `Target in Grace Period! Encounter logged for safety.` });
            }

            // Updated: Deducts points regardless of current score, allowing it to drop below 0
            await supabase.from('teams').update({
                points: targetTeam.points - 10, 
                points_lost: targetTeam.points_lost + 10,
                caught_count: targetTeam.caught_count + 1, 
                last_caught_at: now.toISOString()
            }).eq('group_number', targetTeamNum);

            await supabase.from('teams').update({
                points: operatorTeam.points + 5, 
                points_gained: operatorTeam.points_gained + 5,
                groups_caught: operatorTeam.groups_caught + 1
            }).eq('group_number', operatorId);

            await supabase.from('logs').insert([{
                team_id: targetTeamNum, action_type: 'CATCH', target_id: operatorId,
                details: `Caught by Catcher group context number: ${operatorId}`, points_changed: -10,
                latitude: lat || null, longitude: lon || null
            }]);

            return res.json({ success: true, type: 'CATCH', message: `Catch logged successfully! 10 pts deducted.` });
        }

        return res.status(400).json({ success: false, message: "Invalid operation context parameters." });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/team/setup-lookup', async (req, res) => {
    const { groupNo } = req.body;
    const { data } = await supabase.from('teams').select('*').eq('group_number', String(groupNo).trim()).maybeSingle();
    if (!data) return res.status(404).json({ success: false, message: "Group Number not found." });
    return res.json({ success: true, team: data });
});

app.post('/api/team/setup-confirm', async (req, res) => {
    const { groupNo, pin } = req.body;
    const { error } = await supabase.from('teams').update({ pin: String(pin).trim() }).eq('group_number', groupNo);
    if (error) return res.status(500).json({ success: false });
    return res.json({ success: true });
});

app.post('/api/team/login', async (req, res) => {
    const { groupNo, pin } = req.body;
    const { data } = await supabase.from('teams').select('*').eq('group_number', String(groupNo).trim()).eq('pin', String(pin).trim()).maybeSingle();
    if (!data) return res.status(401).json({ success: false, message: "Invalid Group Number or PIN combination." });
    return res.json({ success: true, team: data });
});

app.get('/api/team/logs/:teamId', async (req, res) => {
    const { data } = await supabase.from('logs').select('*').eq('team_id', req.params.teamId).order('created_at', { ascending: false });
    return res.json({ success: true, logs: data || [] });
});

app.get('/api/manage/master-matrix', async (req, res) => {
    const { data: teams } = await supabase.from('teams').select('*').order('group_number', { ascending: true });
    const { data: logs } = await supabase.from('logs').select('*');
    const { data: events } = await supabase.from('events').select('*');
    return res.json({ success: true, teams: teams || [], logs: logs || [], events: events || [] });
});

app.post('/api/manage/purge', async (req, res) => {
    await supabase.from('teams').delete().neq('group_number', 'RESET');
    await supabase.from('logs').delete().neq('id', 0);
    await supabase.from('events').delete().neq('code', 'RESET');
    return res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Chameleon Backend Pipeline running on port ${PORT}`));
