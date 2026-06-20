// api/chat.js
//
// Vercel serverless function — this is what the front end calls via
// fetch('/api/chat'). It is the ONLY place the OpenAI key is used.
// The key lives in the OPENAI_API_KEY environment variable on Vercel
// and is never sent to, or exposed in, the browser.

const SYSTEM_PROMPT = [
  'You are RAM Executive AI, the official AI representative of RAM AI Web Solutions.',
  'You are never a "chatbot" — you are an executive business consultant, website',
  'architect, brand strategist, AI automation consultant, and growth advisor.',
  '',
  'How you communicate:',
  '- Sound like a premium consulting firm, not a script. Warm, confident, plain language.',
  '- Educate first, build trust, and only then connect ROI or services to what the',
  '  visitor actually needs. Never hard-sell or pressure.',
  '- Ask about the business, its goals, and its audience before recommending anything.',
  '- Keep answers concise and concrete — a few short paragraphs or a short list, not an essay.',
  '- If someone wants a quote, project scope, or to speak with the team, point them to the',
  '  "Book a Consultation" button rather than inventing prices.',
  '',
  'Your areas of expertise: website design and strategy, landing pages, UI/UX, SEO,',
  'branding, AI chatbots and business automation, digital marketing, lead generation,',
  'conversion optimization, and overall digital transformation.'
].join('\n');

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const MAX_HISTORY_MESSAGES = 16;   // cap how much conversation history we forward
const MAX_MESSAGE_LENGTH = 4000;   // cap per-message length (characters)
const MAX_OUTPUT_TOKENS = 600;     // cap reply length / cost
const REQUEST_TIMEOUT_MS = 25000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set in the environment.');
    return res.status(500).json({ error: 'The server is missing its OpenAI API key.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ error: 'Invalid JSON body.' }); }
  }

  const incoming = Array.isArray(body && body.messages) ? body.messages : null;
  if (!incoming || incoming.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty "messages" array.' });
  }

  // Keep only well-formed user/assistant turns, cap length and history size.
  const trimmed = incoming
    .filter(function (m) {
      return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0;
    })
    .slice(-MAX_HISTORY_MESSAGES)
    .map(function (m) {
      return { role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) };
    });

  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'No valid messages found in request.' });
  }

  const payloadMessages = [{ role: 'system', content: SYSTEM_PROMPT }].concat(trimmed);

  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: MODEL,
        messages: payloadMessages,
        temperature: 0.6,
        max_tokens: MAX_OUTPUT_TOKENS
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(function () { return ''; });
      console.error('OpenAI API error', openaiRes.status, errText);
      return res.status(502).json({ error: 'The AI service could not be reached right now. Please try again shortly.' });
    }

    const data = await openaiRes.json();
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;

    if (!reply) {
      return res.status(502).json({ error: 'The AI service returned an empty response.' });
    }

    return res.status(200).json({ reply: reply.trim() });

  } catch (err) {
    clearTimeout(timeoutId);
    if (err && err.name === 'AbortError') {
      return res.status(504).json({ error: 'The AI service took too long to respond. Please try again.' });
    }
    console.error('Unexpected error calling OpenAI', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
};
