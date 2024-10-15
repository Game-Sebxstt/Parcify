import { GoogleGenerativeAI } from '@google/generative-ai';
import { instructions } from '../utilities/instructions.js';
import { getConnection } from "../utilities/database.js";
import { normalizeShape, validateShapeInput } from '../utilities/generative-ai.js';

const connection = await getConnection();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" });

const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: 8192,
    responseSchema: {
        type: "object",
        properties: {
            canvasShapes: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        action: { type: "string" },
                        shape: { type: "string" },
                        fill: { type: "string" },
                        x: { type: "number" },
                        y: { type: "number" },
                        size: {
                            type: "object",
                            properties: {
                                width: { type: "number" },
                                height: { type: "number" },
                            },
                            required: ["width", "height"]
                        },
                        text: { type: "string" },
                        fontSize: { type: "number" },
                        fontFamily: { type: "string" },
                        rotation: { type: "number" },
                    },
                    required: ["action"]
                }
            },
            resume: {
                type: "string"
            }
        },
        required: ["canvasShapes", "resume"]
    }
};

const cache = new Map();

export const generateCanvas = async (req, res) => {
    const { prompt, canvasSummary } = req.body;
    
    if (cache.has(prompt)) {
        return res.json(cache.get(prompt));
    }

    try {
        const fullPrompt = `${instructions}\n\nUsuario: ${prompt}\n\nContexto actual: ${JSON.stringify(canvasSummary)}`;

        console.log('Generating content with prompt:', fullPrompt);

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }]}],
            generationConfig,
        });

        const response = await result.response;
        const text = response.text();

        let jsonResponse;
        const textFormatted = text.replace(/`/g, '"');
        try {
            jsonResponse = JSON.parse(textFormatted);
        } catch (parseError) {
            console.error('Error parsing JSON response:', parseError);
            console.error('Response:', textFormatted);
            return res.status(400).send('Model response is not valid JSON');
        }

        if (!jsonResponse.canvasShapes || !Array.isArray(jsonResponse.canvasShapes)) {
            return res.status(400).send('Response does not contain a valid canvasShapes array');
        }

        const normalizedShapes = jsonResponse.canvasShapes.map(shape => normalizeShape(shape, canvasSummary));

        const test = normalizedShapes.map(shape => validateShapeInput(shape));

        console.log('Normalized shapes:', test);

        const finalResponse = { canvasShapes: normalizedShapes, resume: jsonResponse.resume };
        cache.set(prompt, finalResponse);
        
        res.json(finalResponse);
    } catch (error) {
        console.error('Error in instruction generation:', error);
        res.status(500).send('Error generating instructions');
    }
};