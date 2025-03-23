const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');

const bot = new TelegramBot(token, { polling: true });

const API_URL = 'https://api.together.xyz/v1/chat/completions';
const PERSONA_DB = 'personas.json';

// Set the default AI model
let currentModel = 'gemini-2.0-flash-lite';

function escapeMarkdown(text) {
    return text.replace(/([_\*\[\]\(\)~`\>\#\+\-\=\|{}.!])/g, '\\$1');
}

// Load personas from database
let personas = {};

function loadPersona(){
    if (fs.existsSync(PERSONA_DB)) {
        personas = JSON.parse(fs.readFileSync(PERSONA_DB, 'utf8'));
    }
}

loadPersona();

// Define the bot's description
const botDescription = `
- Use "/ai [your prompt]": Send your prompt as an argument to receive a response. You can insert a "[role name]" tag before your prompt for custom roles.

- Use "/persona [role name] [role description]": Add a custom role with a specific description. Or just use "/persona" to get a list of all available personas.

- Use "/model": View the current AI model in use. Add your preferred model as an argument to switch models. For example, "/model metal-llama-something" to change the model.

- Use "/info" to access these instructions again.
`;

// Handle /info command
bot.onText(/\/(info|start)/, (msg) => {
    bot.sendMessage(msg.chat.id, botDescription);
});

// Handle /persona command
bot.on('message', async (msg) => {    
    if (msg.text && msg.text.startsWith('/persona')) {
        const personaData = msg.text.replace('/persona', '').trim();
        
        loadPersona();
        if (personaData.length === 0) {
            // generate list with expandable quote (only god knows what happened here, but it works and I refuse to either touch or study it)
            const personaListText = Object.keys(personas).map(personaName => {
                const escapedName = escapeMarkdown(personaName);
                const escapedDescription = escapeMarkdown(personas[personaName]).split('\n');
                return `> **${escapedName}**\n> ${escapedDescription}\n> ||`;
            }).join('\n\n');
            
            const responseText = `*Available Personas:*\n\n${personaListText}`;
            
            return bot.sendMessage(msg.chat.id, responseText, { reply_to_message_id: msg.message_id, parse_mode: 'MarkdownV2' });
        } else {
            // Add or update a persona
            const personaMatch = personaData.match(/^\[(.+?)\]\s*(.*)$/s);
            console.log(personaData);
            if (personaMatch) {
                const personaName = personaMatch[1].toLowerCase();
                const personaDescription = personaMatch[2].trim();
                
                personas[personaName] = personaDescription;
                fs.writeFileSync(PERSONA_DB, JSON.stringify(personas, null, 2));
                
                return bot.sendMessage(msg.chat.id, `Persona '${personaName}' saved successfully!`);
            } else {
                return bot.sendMessage(msg.chat.id, 'Error: Please provide a valid persona format: /persona [name] [description]', { parse_mode: 'MarkdownV2' });
            }
        }
    }
    

    // Handle /model command
    if (msg.text && msg.text.startsWith('/model')) {

        const modelList = [
            "gemini-2.0-flash-lite", 
            "gemini-2.0-flash", 
            "meta-llama/Llama-3.3-70B-Instruct-Turbo", 
            "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
            ];
        const modelData = msg.text.replace('/model', '').trim();
        
        if (!modelData) {

            const modelListText = modelList.map(model => `\`${model}\``).join('\n');
            const responseText = `*Available Models:*\n${modelListText}\n\n*Current Model:*\n\`${currentModel}\``;
    
            bot.sendMessage(msg.chat.id, responseText, { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' });
        } else if (modelList.includes(modelData)) {
            currentModel = modelData;
            return bot.sendMessage(msg.chat.id, `Model set to '${currentModel}'.`);
        } else {
            return bot.sendMessage(msg.chat.id, `An error occured when setting the model!`);
        }
    }
    

    // Handle /ai command
    if (msg.text && msg.text.startsWith('/ai')) {
        let userMessage = msg.text.replace('/ai', '').trim();
        let systemMessage = null;
        
        // Check if the message contains a persona keyword in brackets
        const personaMatch = userMessage.match(/^\[(\w+)\]\s*([\s\S]+)$/);
        if (personaMatch) {
            const personaKey = personaMatch[1].toLowerCase();
            userMessage = personaMatch[2].trim();
            systemMessage = personas[personaKey] || null;
        }
        
        if (!userMessage) {
            return bot.sendMessage(msg.chat.id, 'Error: Please provide a message after /ai.');
        }
        
        console.log(`Processing AI request: ${userMessage} (Persona: ${systemMessage || 'None'}), Model: ${currentModel}`);
        
        try {
            if (currentModel.includes('gemini')) {
                // Gemini API request format
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`,
                    {
                        system_instruction: {
                            parts: [
                                {
                                    text: systemMessage || "You are a helpful assistant." // Default instruction if no persona provided
                                }
                            ]
                        },
                        contents: [
                            {
                                parts: [
                                    {
                                        text: userMessage
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );

                console.log(`Gemini API Response: ${JSON.stringify(response.data, null, 2)}`);
                
                if (response.data && response.data.candidates && response.data.candidates.length > 0) {
                    const aiResponse = response.data.candidates[0].content.parts[0].text;
                    bot.sendMessage(msg.chat.id, aiResponse, { reply_to_message_id: msg.message_id });
                } else {
                    bot.sendMessage(msg.chat.id, 'Error: No valid response from Gemini API.', { reply_to_message_id: msg.message_id });
                }

            } else {
                // For other models, use the default API (OpenAI or whatever is set)
                const messages = systemMessage 
                    ? [{ role: "system", content: systemMessage }, { role: "user", content: userMessage }]
                    : [{ role: "user", content: userMessage }];
                
                const response = await axios.post(API_URL, {
                    model: currentModel,
                    messages: messages
                }, {
                    headers: {
                        'Authorization': `Bearer ${secretApiKey}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                console.log(`API Response: ${JSON.stringify(response.data, null, 2)}`);
                
                if (response.data.choices && response.data.choices.length > 0) {
                    let aiResponse = response.data.choices[0].message.content;
                    
                    // Identify and remove the "think" section
                    const thinkStart = '<think>';
                    const thinkEnd = '</think>';
                    if (aiResponse.includes(thinkStart) && aiResponse.includes(thinkEnd)) {
                        aiResponse = aiResponse.replace(
                            aiResponse.substring(aiResponse.indexOf(thinkStart), aiResponse.indexOf(thinkEnd) + thinkEnd.length),
                            ''
                        ).trim();
                    }
                    
                    bot.sendMessage(msg.chat.id, aiResponse, { reply_to_message_id: msg.message_id });
                } else {
                    bot.sendMessage(msg.chat.id, 'Error: No valid response from API.', { reply_to_message_id: msg.message_id });
                }
            }
        } catch (error) {
            console.error('API Error:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
            bot.sendMessage(msg.chat.id, `Error: ${error.response ? error.response.data.error || 'Unknown API error' : error.message}`, { reply_to_message_id: msg.message_id });
        }
    }
});
