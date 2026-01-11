import { Client, GatewayIntentBits } from 'discord.js';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import fs from 'fs';
import config from './config.json' assert { type: "json" };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const systemPrompt = {
  role: "system",
  content: config.systemPrompt
};

const openrouter = createOpenRouter({ apiKey: config.AIkey });
let model = openrouter(config.model);

const DISCORD_MESSAGE_LIMIT = 2000;
const SOFT_SPLIT_THRESHOLD = 4000;

const MEMORY_FILE = './memory.json';
let memory = [];

function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    memory = JSON.parse(data);
  } catch (err) {
    memory = [];
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory.slice(-50), null, 2));
}

const messageQueues = new Map();

function enqueueMessage(channelId, handler) {
  if (!messageQueues.has(channelId)) {
    messageQueues.set(channelId, []);
  }
  const queue = messageQueues.get(channelId);
  queue.push(handler);
  console.log(`Enqueued message. Queue size: ${queue.length}`);
  if (queue.length === 1) {
    processQueue(channelId);
  }
}

async function processQueue(channelId) {
  const queue = messageQueues.get(channelId);
  while (queue.length > 0) {
    console.log(`Processing message. Remaining in queue: ${queue.length - 1}`);
    const job = queue[0];
    try {
      await job();
    } catch (err) {
      console.error(`Error processing job:`, err);
    }
    queue.shift();
    console.log(`Finished message. Queue size now: ${queue.length}`);
  }
  console.log(`Queue is empty.`);
}

function resetMemory() {
  memory = [];
  saveMemory();
}

function splitMessage(text, maxLen) {
  const chunks = [];
  let remaining = String(text ?? '');

  while (remaining.length > maxLen) {
    let cut = maxLen;
    const windowStart = Math.max(0, maxLen - 200);
    const window = remaining.slice(windowStart, maxLen);
    const lastNewline = window.lastIndexOf('\n');
    const lastSpace = window.lastIndexOf(' ');
    const splitAt = Math.max(lastNewline, lastSpace);
    if (splitAt !== -1) {
      cut = windowStart + splitAt;
    }
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\s+/, '');
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

async function sendSplitReply(message, text) {
  const content = String(text ?? '');
  const needsSplit = content.length > SOFT_SPLIT_THRESHOLD || content.length > DISCORD_MESSAGE_LIMIT;
  if (!needsSplit) {
    await message.reply(content);
    return;
  }
  const chunks = splitMessage(content, DISCORD_MESSAGE_LIMIT);
  if (chunks.length === 0) return;
  await message.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await message.channel.send(chunks[i]);
  }
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadMemory();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== config.channelId) return;
  if (message.content.startsWith(".")) return;

  try {
  if (message.content === '!reset' && message.author.id === config.adminId) {
    resetMemory();
    await message.reply('🧠 Memory zeroed.');
    return;
  }
  
  if (message.content.startsWith('!model')  && message.author.id === config.adminId) {
    model = openrouter(message.content.split(' ')[1])
    console.log(model)
    await message.reply('Set model to: ' + model);
    return;
  }} catch (e) { console.warn (e) }

  enqueueMessage(message.channel.id, async () => {
    await message.channel.sendTyping();

    memory.push({ role: "user", content: `${message.content}` });
    if (memory.length > 100) memory.shift();

    try {
      let now = performance.now();
      const response = await generateText({
        model,
        messages: [systemPrompt, ...memory],
        providerOptions: {
          openrouter: {
            reasoning: {
              max_tokens: 10,
            },
          },
        },
      });

      const reply = response.content.find(item => item.type === 'text')?.text || '';
      memory.push({ role: "assistant", content: reply });
      saveMemory();

      await sendSplitReply(message, reply);
      client.user.setActivity({
        name: `my mouth in ${((performance.now() - now) / 1000).toFixed(2)}s`
      });
      console.log(`Message took ${((performance.now() - now) / 1000).toFixed(2)} seconds.`);

    } catch (err) {
      console.error("AI error:", err);
      await message.reply("Something went wrong? " + err?.data?.error?.message);
    }
  });
});

client.login(config.discordToken);
