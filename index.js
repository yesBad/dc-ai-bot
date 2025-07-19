import { Client, GatewayIntentBits, ActivityType } from 'discord.js';
import { OpenAI } from 'openai';
import fs from 'fs';
import config from './config.json' assert { type: "json" };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const openai = new OpenAI({ apiKey: config.openaiApiKey });
const systemPrompt = {
  role: "system",
  content: config.systemPrompt
};

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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  loadMemory();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== config.channelId) return;
  if (message.content.startsWith(".")) return;

  if (message.content === '!reset' && message.author.id === config.adminId) {
    resetMemory();
    await message.reply('🧠 Memory zeroed.');
    return;
  }

  enqueueMessage(message.channel.id, async () => {
    await message.channel.sendTyping();

    memory.push({ role: "user", content: `${message.author.username}: ${message.content}` });
    if (memory.length > 100) memory.shift();

    try {
      let now = performance.now();
      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [systemPrompt, ...memory],
      });

      const reply = response.choices[0].message.content;
      memory.push({ role: "assistant", content: reply });
      saveMemory();

      await message.reply(reply);
      client.user.setActivity({
        name: `my mouth in ${((performance.now() - now) / 1000).toFixed(2)}s`
      });
      console.log(`Message took ${((performance.now() - now) / 1000).toFixed(2)} seconds.`);

    } catch (err) {
      console.error("OAI error:", err);
      await message.reply("⚠️ Something went wrong.");
    }
  });
});

client.login(config.discordToken);
