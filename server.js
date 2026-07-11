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

// Helper function to generate an unguessable 8-digit team backup code
function generateRandomBackupCode() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// Helper function to generate a secure 6-digit waypoint code
function generateRandomWaypointCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- DIRECT DATABASE INJECTION ROUTES ---

// Bulk upload teams (Auto-generates 8-digit passport codes if missing)
app.post('/api/manage/inject-people-json', async (req, res) => {
    try {
        const { payload } = req.body; 
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ success: false, message: "Invalid JSON array payload layout." });
        }
        
        await supabase.from('teams').delete().neq('group_number', 'RESET_FORCE');
        
        const enrichedPayload = payload.map(team => ({
            ...team,
            backup_code: team.backup_code || generateRandomBackupCode(),
            points: team.points || 0,
            points_gained: team.points_gained || 0,
            points_lost: team.points_lost || 0,
            caught_count: team.caught_count || 0,
            groups_caught: team.groups_caught || 0
        }));

        const { error } = await supabase.from('teams').insert(enrichedPayload);
        if (error) throw error;
        
        return res.json({ success: true, count: enrichedPayload.length });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Bulk upload waypoints (Forces generation of secure 6-digit codes)
app.post('/api/manage/inject-event-json', async (req, res) => {
    try {
        const { payload } = req.body;
        if (!payload || !Array.isArray(payload)) {
            return res.status(400).json({ success: false, message: "Invalid JSON array payload layout." });
        }

        await supabase.from('events').delete().neq('code', 'RESET_FORCE');
        
        const enrichedPayload = payload.map(event => {
            const currentCode = String(event.code || '').trim();
            return {
                ...event,
                // Replace W01, W02, AUTO_GEN or empty values with secure random 6 digits
                code: (currentCode === 'AUTO_GEN' || currentCode.startsWith('W0') || !currentCode) 
                    ? generateRandomWaypointCode() 
                    : currentCode
            };
        });

        const { error } = await supabase.from('events').insert(enrichedPayload);
        if (error) throw error;

        return res.json({ success: true, count: enrichedPayload.length });
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

// --- CLIENT SCANNERS & PASSPORT PROCESSOR ENGINE ---
app.post('/api/client/scan-waypoint', async (req, res) => {
    let { teamId, code, lat, lon } = req.body;
    try {
        let cleanCode = String(code).trim();

        const { data: ev } = await supabase.from('events').select('*').eq('code', cleanCode).eq('type', 'Waypoint').maybeSingle();
        if (!ev) return res.status(404).json({ success: false, message: `Waypoint ${cleanCode} does not exist.` });

        const { data: team } = await supabase.from('teams').select('*').eq('group_number', teamId).maybeSingle();
        if (!team) return res.status(404).json({ success: false, message: "Team record profile lost." });

        if (ev.target_group !== 'All' && !ev.target_group.toLowerCase().includes(team.category.toLowerCase())) {
            return res.status(403).json({ success: false, message: "This waypoint is not designated for your category." });
        }

        const { data: duplicated } = await supabase.from('logs').select('*')
            .eq('team_id', teamId).eq('target_id', cleanCode).eq('action_type', 'WAYPOINT').maybeSingle();
        if (duplicated) return res.status(400).json({ success: false, message: `Waypoint already claimed.` });

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

        return res.json({ success: true, code: cleanCode });
    } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
});

app.post('/api/client/process-passport', async (req, res) => {
    const { operatorId, scannedPassportString, currentCheckpointContext, lat, lon } = req.body;
    try {
        const cleanInputToken = String(scannedPassportString).trim();
        
        const { data: targetTeam } = await supabase.from('teams').select('*').eq('backup_code', cleanInputToken).maybeSingle();
        if (!targetTeam) return res.status(404).json({ success: false, message: "Security Token mismatch. No matching group profile." });

        const targetTeamNum = targetTeam.group_number;

        // Checkpoint Mode Check-in
        if (currentCheckpointContext) {
            const { data: duplicatedCheckin } = await supabase.from('logs').select('*')
                .eq('team_id', targetTeamNum).eq('target_id', currentCheckpointContext).eq('action_type', 'CHECKIN').maybeSingle();
            
            if (duplicatedCheckin) return res.status(400).json({ success: false, message: "Team already verified at this Checkpoint." });

            await supabase.from('logs').insert([{
                team_id: targetTeamNum, action_type: 'CHECKIN', target_id: currentCheckpointContext,
                details: `Signed into Checkpoint station: ${currentCheckpointContext}`,
                latitude: lat || null, longitude: lon || null
            }]);
            return res.json({ success: true, type: 'CHECKIN', message: `Group ${targetTeamNum} Signed In Successfully` });
        }

        // Catcher Mode Catching
        const { data: operatorTeam } = await supabase.from('teams').select('*').eq('group_number', operatorId).maybeSingle();

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
                return res.json({ success: true, type: 'GRACE', message: `Target in Grace Period!` });
            }

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
app.listen(PORT, () => console.log(`Backend Matrix Active on port ${PORT}`));