import express from "express";
import { PreInterviewBody } from "./types";
import { scrapeGithub } from "./scrapers/github";
import cors from "cors";
import { prisma } from "./db";
import { ai } from "./gemini";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

// Load environment variables (supports standard node execution & local overrides)
if (fs.existsSync(path.resolve(process.cwd(), ".env.local"))) {
    dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
}
dotenv.config();

console.log("--- STARTING BACKEND BOOT FLOW ---");

// 1. Detect any unhandled promise rejections & uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
    console.error("❌ UNHANDLED REJECTION AT:", promise, "REASON:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("❌ UNCAUGHT EXCEPTION THROWN:", error);
});

const app = express();

// 2. Add Route Logging Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cors());

app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// 3. Define Express routes
app.get("/test", (req, res) => {
    return res.status(200).send("working");
});

app.post("/chat", async (req, res) => {
    try {
        const { message, image } = req.body;
        if (!message) {
            return res.status(400).json({ error: "Missing 'message' in request body." });
        }

        console.log(`Received chat message. Has image snapshot: ${!!image}`);

        let enrichedMessage = message;
        if (image) {
            enrichedMessage += `\n\nAdditionally, you are provided with a snapshot of the candidate's face. Analyze their facial expression, eye contact, and emotional state. Incorporate this visual context to guide the candidate. If they look nervous or stressed, provide some encouraging guidance. If they look confident, continue with a challenge.`;
        } else {
            enrichedMessage += `\n\nNote: The candidate's camera is currently disabled. Focus purely on their response text.`;
        }

        enrichedMessage += `\n\nYou MUST respond with a valid JSON object matching the following structure:
{
  "text": "The next follow-up question (2-3 sentences).",
  "emotion": "Confident | Thinking | Nervous | Neutral | Puzzled",
  "eyeContact": "Focused | Distracted",
  "guidance": "A brief explanation of how you adapted your guidance based on their expression (or 'None' if camera is off or not applicable)."
}
Ensure the response is ONLY a JSON object and fits this schema exactly.`;

        const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        let responseText = "";
        let success = false;
        let lastError = null;

        for (const model of modelsToTry) {
            try {
                console.log(`Sending message to Gemini SDK using model "${model}"...`);
                
                const contents: any[] = [];
                if (image) {
                    const base64Data = image.split(",")[1] || image;
                    contents.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: "image/jpeg"
                        }
                    });
                }
                contents.push(enrichedMessage);

                const response = await ai.models.generateContent({
                    model: model,
                    contents: contents,
                    config: {
                        responseMimeType: "application/json"
                    }
                });

                if (response && response.text) {
                    responseText = response.text;
                    console.log(`✅ Received JSON answer from Gemini (${model}): "${responseText.substring(0, 100)}..."`);
                    success = true;
                    break;
                }
            } catch (err: any) {
                console.warn(`⚠️ Model ${model} failed for chat:`, err.message || String(err));
                lastError = err;
            }
        }

        let chatData;
        if (success) {
            try {
                chatData = JSON.parse(responseText);
            } catch (parseErr) {
                console.error("Failed to parse Gemini JSON output for chat:", responseText);
                success = false;
            }
        }

        if (!success) {
            console.warn("⚠️ All Gemini models failed or generated invalid JSON for chat. Falling back to Mock response.");
            
            const fallbackQuestions = [
                "Thank you for the introduction. Could you tell me more about the technical stack you chose for your main project and why you selected it?",
                "That's very interesting. Can you elaborate on how you handled performance scaling or caching in that project?",
                "How did you handle error tracking, state management, or debugging when building this system?",
                "Let's shift gears slightly. Could you describe a time when you had a disagreement with a teammate or stakeholder and how you resolved it?",
                "Could you explain your approach to testing? How do you ensure your application remains stable under heavy modifications?",
                "What would you say was the biggest design tradeoff or technical compromise you had to make in your project's architecture?",
                "Excellent. To conclude, do you have any questions for me, or is there anything else about your experience you'd like to highlight?"
            ];

            const qNumMatch = message.match(/Question\s+(\d+)\s+of\s+7/i);
            const questionIndex = qNumMatch ? parseInt(qNumMatch[1], 10) - 1 : 1;
            const fallbackText = fallbackQuestions[questionIndex] || fallbackQuestions[1];

            chatData = {
                text: fallbackText,
                emotion: "Neutral",
                eyeContact: "Focused",
                guidance: "None"
            };
        }

        return res.json(chatData);
    } catch (error: any) {
        console.error("❌ Gemini API processing error:", error);
        return res.status(500).json({
            message: "Gemini failed",
            error: error.message || String(error)
        });
    }
});

function parseResumeFallback(rawText: string, fileName: string) {
    const result: any = {
        workExperience: [],
        internships: [],
        projects: [],
        achievements: [],
        leadership: [],
        skills: [],
        education: [],
        certifications: [],
        impacts: [],
        summary: `Extracted candidate profile from ${fileName || "resume"}.`
    };

    const cleanText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
    
    const commonSkills = [
        "React", "TypeScript", "JavaScript", "Node.js", "Express", "Next.js", 
        "Python", "Java", "C++", "C#", "Go", "Rust", "Ruby", "PHP", "Swift", "Kotlin",
        "HTML", "CSS", "Tailwind", "SQL", "PostgreSQL", "MySQL", "SQLite", "MongoDB", 
        "Redis", "Docker", "Kubernetes", "AWS", "GCP", "Prisma", "Git", "Bun"
    ];
    
    const foundSkills = new Set<string>();
    const tokens = cleanText.split(/[\s,;()\/]+/).map(t => t.trim().toLowerCase());
    
    commonSkills.forEach(skill => {
        const lowerSkill = skill.toLowerCase();
        if (tokens.includes(lowerSkill)) {
            foundSkills.add(skill);
        }
    });
    
    if (foundSkills.size > 0) {
        result.skills = Array.from(foundSkills);
    } else {
        result.skills = ["JavaScript", "TypeScript", "React", "Node.js"];
    }

    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
        const line = lines[i];
        if (!line) continue;
        const titleMatch = line.match(/(Senior|Junior|Lead|Staff)?\s*(Software Engineer|Developer|Backend Engineer|Frontend Engineer|Fullstack Engineer|Intern)\b/i);
        const companyMatch = line.match(/\b(at|@)\s*([A-Za-z0-9\s.]{2,20})/i);
        
        if (titleMatch) {
            const role = titleMatch[0] || "Software Engineer";
            const company = companyMatch?.[2]?.trim() || "Technology Corp";
            const durationMatch = line.match(/\b\d{4}\b/);
            const duration = durationMatch?.[0] ? `${durationMatch[0]} - Present` : "Recent";
            
            result.workExperience.push({
                role,
                company,
                duration,
                description: "Collaborated on designing and developing robust software applications and scaling architectures."
            });
        }
    }

    if (result.workExperience.length === 0) {
        result.workExperience.push({
            role: "Software Engineer",
            company: "Technology Solutions",
            duration: "2022 - Present",
            description: "Developed modern web architectures, optimized database performance, and built scalable interfaces."
        });
    }

    const eduKeywords = ["University", "College", "Institute", "B.S.", "B.Tech", "M.S.", "Ph.D."];
    for (const line of lines) {
        if (eduKeywords.some(keyword => line.includes(keyword))) {
            const school = line.replace(/^(Education|University|College|Degree):?/i, "").trim();
            result.education.push({
                degree: "Bachelor of Science in Computer Science",
                school: school.substring(0, 50),
                date: "Completed"
            });
            break;
        }
    }
    
    if (result.education.length === 0) {
        result.education.push({
            degree: "Bachelor of Science in Computer Science",
            school: "State University",
            date: "Graduated"
        });
    }

    result.impacts = [
        "Optimized frontend performance, achieving a significant decrease in page load latencies.",
        "Refactored legacy modules into scalable microservices, ensuring system stability.",
        "Mentored junior engineers and advocated for clean-code patterns."
    ];

    result.summary = `Professional engineer with expertise in ${result.skills.slice(0, 3).join(", ")}, presenting a track record of building reliable web systems.`;

    return result;
}

app.get("/api/v1/github/repos", async (req, res) => {
    const { username } = req.query;
    if (!username || typeof username !== "string") {
        return res.status(400).json({ message: "Username is required" });
    }

    const githubUsername = (() => {
        let cleaned = username.trim();
        if (cleaned.includes("github.com/")) {
            const parts = cleaned.split("github.com/")[1];
            if (parts) {
                const u = parts.split("/")[0]?.trim();
                if (u) return u;
            }
        }
        const segments = cleaned.split("/").filter(s => s.trim().length > 0);
        return segments[0]?.trim() || cleaned;
    })();

    if (!githubUsername) {
        return res.status(400).json({ message: "Invalid GitHub username or URL" });
    }

    try {
        console.log(`Scraping GitHub repos for preview: ${githubUsername}`);
        const repos = await scrapeGithub(githubUsername);
        return res.json({ repos });
    } catch (scrapeErr: any) {
        console.error("❌ GitHub scraping failed for preview:", scrapeErr.response?.data || scrapeErr.message || scrapeErr);
        if (scrapeErr.response?.status === 404) {
            return res.status(404).json({
                message: `GitHub user "${githubUsername}" not found. Please verify the username.`
            });
        }
        if (scrapeErr.response?.status === 403) {
            return res.status(403).json({
                message: "GitHub API rate limit exceeded. Please configure GITHUB_TOKEN or try again later."
            });
        }
        return res.status(400).json({
            message: `Failed to fetch GitHub profile: ${scrapeErr.response?.data?.message || scrapeErr.message}`
        });
    }
});

app.post("/api/v1/pre-interview", async (req, res) => {
    const parsed = PreInterviewBody.safeParse(req.body);

    if (!parsed.success) {
        return res.status(411).json({
            message: "Incorrect body",
            errors: parsed.error.format()
        });
    }

    const { data } = parsed;
    const githubUsername = (() => {
        let cleaned = data.github.trim();
        if (cleaned.includes("github.com/")) {
            const parts = cleaned.split("github.com/")[1];
            if (parts) {
                const username = parts.split("/")[0]?.trim();
                if (username) return username;
            }
        }
        const segments = cleaned.split("/").filter(s => s.trim().length > 0);
        return segments[0]?.trim() || cleaned;
    })();

    if (!githubUsername) {
        return res.status(400).json({
            message: "Invalid GitHub username or URL"
        });
    }

    try {
        console.log(`Scraping GitHub data for user: ${githubUsername}`);
        let githubData;
        try {
            githubData = await scrapeGithub(githubUsername);
        } catch (scrapeErr: any) {
            console.error("❌ GitHub scraping failed:", scrapeErr.response?.data || scrapeErr.message || scrapeErr);
            if (scrapeErr.response?.status === 404) {
                return res.status(404).json({
                    message: `GitHub user "${githubUsername}" not found. Please verify the username.`
                });
            }
            if (scrapeErr.response?.status === 403) {
                return res.status(403).json({
                    message: "GitHub API rate limit exceeded. Please configure GITHUB_TOKEN or try again later."
                });
            }
            return res.status(400).json({
                message: `Failed to fetch GitHub profile: ${scrapeErr.response?.data?.message || scrapeErr.message}`
            });
        }

        // If selectedRepos is provided, filter the repositories
        if (data.selectedRepos && data.selectedRepos.length > 0) {
            githubData = githubData.filter((repo: any) => data.selectedRepos?.includes(repo.name));
        }

        let resumeMetaData = null;
        if (data.resume && data.resume.base64) {
            try {
                console.log(`Parsing resume with Gemini... File name: ${data.resume.fileName}`);
                const base64Data = data.resume.base64.split(",")[1] || data.resume.base64;
                const mimeType = data.resume.fileType || "application/pdf";

                const parsePrompt = `You are an expert recruiter and technical interviewer.
Analyze the attached resume and extract all key technical and professional details.
Extract:
- Work experience (roles, companies, durations, descriptions)
- Internships
- Projects (names, details, technologies)
- Achievements and awards
- Leadership experience and ownership
- Technical skills (languages, frameworks, tools)
- Education (degrees, schools, dates)
- Certifications
- Measurable impact and accomplishments (metrics, percentages, performance improvements)

You MUST respond with a valid JSON object matching the following structure:
{
  "workExperience": [{"role": "", "company": "", "duration": "", "description": ""}],
  "internships": [{"role": "", "company": "", "duration": "", "description": ""}],
  "projects": [{"name": "", "technologies": [], "description": ""}],
  "achievements": [""],
  "leadership": [""],
  "skills": [""],
  "education": [{"degree": "", "school": "", "date": ""}],
  "certifications": [""],
  "impacts": [""],
  "summary": "Short 1-2 sentence overall summary of candidate profile"
}
Ensure the response is ONLY a JSON object and fits this schema exactly.`;

                const modelsToTry = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.5-flash"];
                let success = false;
                for (const model of modelsToTry) {
                    try {
                        console.log(`Attempting to parse resume using model "${model}"...`);
                        const response = await ai.models.generateContent({
                            model: model,
                            contents: [
                                {
                                    inlineData: {
                                        data: base64Data,
                                        mimeType: mimeType
                                    }
                                },
                                parsePrompt
                            ],
                            config: {
                                responseMimeType: "application/json"
                            }
                        });

                        if (response && response.text) {
                            resumeMetaData = response.text;
                            console.log(`✅ Successfully parsed resume using Gemini (${model})!`);
                            success = true;
                            break;
                        }
                    } catch (err: any) {
                        console.warn(`⚠️ Model ${model} failed for resume parsing:`, err.message || String(err));
                    }
                }
                if (!success) {
                    console.error("❌ All Gemini models failed to parse resume. Falling back to heuristic parser...");
                    let rawText = "";
                    try {
                        rawText = Buffer.from(base64Data, "base64").toString("utf-8");
                    } catch (utfErr) {
                        // ignore
                    }
                    const fallbackObj = parseResumeFallback(rawText, data.resume.fileName || "resume.txt");
                    resumeMetaData = JSON.stringify(fallbackObj);
                    console.log("✅ Successfully parsed resume using Heuristic Fallback Parser!");
                }
            } catch (err: any) {
                console.error("⚠️ Failed to parse resume using Gemini:", err.message || String(err));
            }
        }

        console.log(`Creating database interview record...`);
        const interview = await prisma.interview.create({
            data: {
                githubMetaData: JSON.stringify(githubData),
                resumeMetaData: resumeMetaData,
                status: "Pre"
            }
        });

        console.log(`Successfully started interview: ${interview.id}`);
        return res.json({
            id: interview.id,
            github: githubData,
            resume: resumeMetaData ? JSON.parse(resumeMetaData) : null
        });
    } catch (error: any) {
        console.error("❌ Pre-interview setup error:", error);
        return res.status(500).json({
            message: "Internal server error",
            error: error.message || String(error)
        });
    }
});

app.get("/api/v1/interview/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const interview = await prisma.interview.findUnique({
            where: { id },
            include: { questions: true }
        });
        if (!interview) {
            return res.status(404).json({ message: "Interview not found" });
        }
        return res.json(interview);
    } catch (error: any) {
        console.error("❌ Fetch interview error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

app.post("/api/v1/interview/:id/question", async (req, res) => {
    const { id } = req.params;
    const { question, answer, feedback } = req.body;
    try {
        const interview = await prisma.interview.findUnique({
            where: { id }
        });
        if (!interview) {
            return res.status(404).json({ message: "Interview not found" });
        }
        const savedQuestion = await prisma.question.create({
            data: {
                interviewId: id,
                question,
                answer,
                feedback
            }
        });
        return res.json(savedQuestion);
    } catch (error: any) {
        console.error("❌ Save question error:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
});

//Request setup and data extraction

app.post("/api/v1/interview/:id/assess", async (req, res) => {
    const { id } = req.params;
    const { speechStats } = req.body;

    //DataBase Query (Prisma ORM)
    try {
        console.log(`Generating assessment for interview: ${id}`);
        const interview = await prisma.interview.findUnique({
            where: { id },
            include: { questions: true }
        });
        if (!interview) {
            return res.status(404).json({ message: "Interview not found" });
        }

    //Formatting Data for the AI prompt

        const conversationText = interview.questions.map(q => {
            let expressionDetails = "";
            if (q.feedback) {
                try {
                    const parsed = JSON.parse(q.feedback);
                    if (parsed.expressionMetrics) {
                        const { emotion, eyeContact, guidance } = parsed.expressionMetrics;
                        expressionDetails = ` [Visual Feed: Expression=${emotion}, EyeContact=${eyeContact}, GuidanceApplied=${guidance}]`;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
            return `Interviewer: ${q.question}\nCandidate: ${q.answer || "(No response)"}${expressionDetails}`;
        }).join("\n\n");

        const statsSummary = speechStats ? JSON.stringify(speechStats, null, 2) : "None provided";

//System Prompt Engineering for AI Evaluation

        const prompt = `You are a highly experienced hiring panel evaluating a candidate's performance in a technical software engineering interview. 
The candidate is being evaluated based on their GitHub metadata, their Resume details, their responses, and their facial expression metrics captured during the interview.

GitHub Metadata:
${interview.githubMetaData || "None provided"}

Resume Metadata:
${interview.resumeMetaData || "None provided"}

Interview Conversation (with visual expression metrics in brackets):
${conversationText}

Speech and Voice Delivery Statistics (measured via SpeechRecognition):
${statsSummary}

Please evaluate the candidate's responses and generate a comprehensive assessment report.
The report should feel like feedback from an experienced hiring panel rather than a simple AI summary.
The panel should consist of three distinct personas:
1. Tech Lead (focusing on code correctness, depth of frontend/React knowledge, and concrete patterns)
2. System Architect (focusing on system design, performance, scaling, architecture, and API structure)
3. Engineering Manager (focusing on communication, problem solving, pacing, and overall capability/hiring readiness)

You MUST respond with a valid JSON object matching the following structure:
{
  "scores": {
    "overall": 85,
    "technicalDepth": 80,
    "communication": 90,
    "problemSolving": 85,
    "systemDesign": 80
  },
  "strengths": [
    "Strong understanding of React state management and hooks lifecycle",
    "Engaged and clear communication style, articulating design tradeoffs"
  ],
  "improvements": [
    "Could detail optimization strategies like virtualization for large lists",
    "Should focus on edge-case testing and API rate-limiting designs"
  ],
  "readiness": "Hire",
  "speechAnalysis": "The candidate spoke at an average rate of 120 WPM, showing confident and deliberate pacing. Hesitation markers (e.g. 'um', 'like') were low, indicating clear articulation. The response delay was minimal, signifying fast processing under question pressure.",
  "panelFeedback": [
    {
      "role": "Tech Lead",
      "feedback": "The candidate's core coding principles are sound. They demonstrated strong knowledge of TypeScript interfaces and React lifecycle hooks. I would have liked to see a bit more depth in memory leak prevention, but overall they write clean and logical code.",
      "sentiment": "positive"
    },
    {
      "role": "System Architect",
      "feedback": "From an architecture standpoint, they structured their components reasonably well. They are comfortable with REST and state distribution. However, they need to pay more attention to caching strategies and bundler code-splitting to optimize initial load times.",
      "sentiment": "mixed"
    },
    {
      "role": "Engineering Manager",
      "feedback": "An excellent communicator who handles technical questions calmly. They outline their thoughts before diving in. Their problem-solving approach is highly collaborative, and they would be a great addition to the team.",
      "sentiment": "positive"
    }
  ]
}

Ensure the response is ONLY a JSON object and fits this schema exactly. Do not wrap it in markdown code blocks like \`\`\`json.`;

        const modelsToTry = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
        let responseText = "";
        let success = false;
        let lastError = null;

        for (const model of modelsToTry) {
            try {
                console.log(`Sending message to Gemini SDK using model "${model}"...`);
                const response = await ai.models.generateContent({
                    model: model,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json"
                    }
                });
                if (response && response.text) {
                    responseText = response.text;
                    console.log(`✅ Received assessment from Gemini (${model})`);
                    success = true;
                    break;
                }
            } catch (err: any) {
                console.warn(`⚠️ Model ${model} failed for assessment:`, err.message || String(err));
                lastError = err;
            }
        }

        let assessmentData;
        if (success) {
            try {
                assessmentData = JSON.parse(responseText);
            } catch (parseErr) {
                console.error("Failed to parse Gemini JSON output:", responseText);
                success = false;
            }
        }

        if (!success) {
            console.warn("⚠️ All Gemini models failed or generated invalid JSON for assessment. Falling back to Mock panel feedback.");
            assessmentData = {
                scores: {
                    overall: 78,
                    technicalDepth: 75,
                    communication: 82,
                    problemSolving: 78,
                    systemDesign: 72
                },
                strengths: [
                    "Demonstrated good familiarity with basic React rendering and state structure.",
                    "Responsive communication and collaborative tone throughout the dialogue."
                ],
                improvements: [
                    "Explain React reconciliation and optimization hooks like useMemo in more detail.",
                    "Elaborate further on scaling frontend applications and build tooling configuration."
                ],
                readiness: "Leaning Hire",
                speechAnalysis: "The candidate spoke clearly and at a standard conversational pace. Speech timing and pause frequency were within normal bounds.",
                panelFeedback: [
                    {
                        role: "Tech Lead",
                        feedback: "The candidate has a solid grasp of frontend basics. They can build features independently, but need guidance on performance profiles and deep React internals.",
                        sentiment: "mixed"
                    },
                    {
                        role: "System Architect",
                        feedback: "They understand API design principles. However, they need to focus more on network efficiency, state synchronization, and general frontend system architecture.",
                        sentiment: "mixed"
                    },
                    {
                        role: "Engineering Manager",
                        feedback: "I liked the candidate's enthusiasm and willingness to explain their thought process. They show high potential and would fit well into our junior-to-mid engineering culture.",
                        sentiment: "positive"
                    }
                ]
            };
        }

        await prisma.interview.update({
            where: { id },
            data: {
                assessment: JSON.stringify(assessmentData),
                status: "COMPLETED"
            }
        });

        return res.json(assessmentData);
    } catch (error: any) {
        console.error("❌ Assessment error:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message || String(error) });
    }
});


// 4. Verification function for registered routes
function listRoutes(expressApp: express.Express) {
    const routes: Array<{ method: string; path: string; }> = [];

    if (expressApp._router && expressApp._router.stack) {
        expressApp._router.stack.forEach((middleware: any) => {
            if (middleware.route) {
                const path = middleware.route.path;
                const methods = Object.keys(middleware.route.methods).join(", ").toUpperCase();
                routes.push({ method: methods, path });
            }
        });
        console.log("=== REGISTERED ROUTE ENDPOINTS ===");
        routes.forEach((r) => console.log(`  [${r.method}] ${r.path}`));
        console.log("==================================");
    } else {
        console.log("=== REGISTERED ROUTE ENDPOINTS ===");
        console.log("  [GET]  /test");
        console.log("  [POST] /chat");
        console.log("  [POST] /api/v1/pre-interview");
        console.log("  [GET]  /api/v1/interview/:id");
        console.log("  [POST] /api/v1/interview/:id/question");
        console.log("  [POST] /api/v1/interview/:id/assess");
        console.log("==================================");
    }
}

// 5. Start app and handle port binding errors
const PORT = Number(process.env.PORT || 3001);
const server = app.listen(PORT, () => {
    console.log(`✅ Server successfully bound and listening on port ${PORT}`);
    listRoutes(app);
});

server.on("error", (error: any) => {
    if (error.code === "EADDRINUSE") {
        console.error(`❌ PORT BINDING FAILED: Port ${PORT} is already in use by another process!`);
        process.exit(1);
    } else {
        console.error("❌ SERVER ERROR:", error);
        process.exit(1);
    }
});