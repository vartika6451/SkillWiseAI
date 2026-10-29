import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import axios from "axios";
import { API_BASE_URL } from "@/lib/config";
import { toast } from "sonner";
import { 
  Cpu, Layers, Mic, FileText, Check, ArrowRight, ArrowLeft,
  Sparkles, Shield, Terminal, Award, Activity, TrendingUp, 
  BarChart3, Globe, CheckCircle2, User, Loader2, Search, Star
} from "lucide-react";

// Local Github icon fallback for compatibility
function Github({ className }: { className?: string }) {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export function Form() {
  const [github, setGithub] = useState("");
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeBase64, setResumeBase64] = useState<string>("");
  const navigate = useNavigate();

  const [step, setStep] = useState<"username" | "select-repos">("username");
  const [repos, setRepos] = useState<any[] | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Validate GitHub URL format
  function validateGithubUrl(url: string) {
    if (!url) return "GitHub URL or username is required";
    
    // Accept user/repo or just username or full URL
    const cleanUrl = url.trim();
    if (cleanUrl.length < 2) return "Please enter a valid GitHub username or URL";
    
    return "";
  }

  // Handle Input Change
  function handleGithubChange(val: string) {
    setGithub(val);
    if (validationError) {
      setValidationError("");
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size exceeds 5MB limit.");
      return;
    }

    if (file.type !== "application/pdf" && file.type !== "text/plain") {
      toast.error("Only PDF or TXT files are supported.");
      return;
    }

    setResumeFile(file);
    const reader = new FileReader();
    reader.onload = () => {
      setResumeBase64(reader.result as string);
      toast.success(`Successfully loaded resume: ${file.name}`);
    };
    reader.onerror = () => {
      toast.error("Failed to read file.");
    };
    reader.readAsDataURL(file);
  };

  const handleToggleRepo = (repoName: string) => {
    setSelectedRepos(prev => 
      prev.includes(repoName)
        ? prev.filter(name => name !== repoName)
        : [...prev, repoName]
    );
  };

  const handleSelectAll = () => {
    if (repos) {
      setSelectedRepos(repos.map(r => r.name));
    }
  };

  const handleDeselectAll = () => {
    setSelectedRepos([]);
  };

  function getCleanUsername() {
    let username = github.trim();
    if (username.includes("github.com/")) {
      const parts = username.split("github.com/");
      if (parts[1]) {
        const urlUsername = parts[1].split("/")[0];
        if (urlUsername) {
          username = urlUsername;
        }
      }
    }
    return username;
  }

  async function handleFetchRepos(e: FormEvent) {
    e.preventDefault();
    const error = validateGithubUrl(github);
    if (error) {
      setValidationError(error);
      toast.error(error);
      return;
    }

    setFetchingRepos(true);
    setValidationError("");
    const username = getCleanUsername();

    try {
      const response = await axios.get(`${API_BASE_URL}/api/v1/github/repos`, {
        params: { username }
      });
      const fetchedRepos = response.data.repos || [];
      setRepos(fetchedRepos);
      setSelectedRepos(fetchedRepos.map((r: any) => r.name));
      setStep("select-repos");
      setFetchingRepos(false);
      toast.success(`Scraped ${fetchedRepos.length} repositories. Please select which are important.`);
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.message || "Error scraping repository list. Ensure the user exists.";
      setValidationError(msg);
      toast.error(msg);
      setFetchingRepos(false);
    }
  }

  async function handleStartInterview(e: FormEvent) {
    e.preventDefault();
    if (selectedRepos.length === 0) {
      setValidationError("Please select at least one important repository to proceed.");
      toast.error("Please select at least one repository.");
      return;
    }

    setLoading(true);
    setValidationError("");
    const username = getCleanUsername();

    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/pre-interview`, {
        github: username,
        selectedRepos: selectedRepos,
        resume: resumeBase64 ? {
          base64: resumeBase64,
          fileName: resumeFile?.name || "resume.pdf",
          fileType: resumeFile?.type || "application/pdf"
        } : undefined
      });
      const interviewId = response.data.id;
      if (interviewId) {
        toast.success("Successfully processed profile & resume! Launching interview...", {
          description: `Loaded profile for ${username}`
        });
        setTimeout(() => {
          navigate(`/interview/${interviewId}`);
        }, 1500);
      } else {
        toast.error("Failed to initialize interview session.");
        setLoading(false);
      }
    } catch (err: any) {
      console.error(err);
      const msg = err.response?.data?.message || "Error starting interview session.";
      toast.error(msg);
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[#7a7dcd] overflow-x-hidden flex flex-col font-sans selection:bg-[#b83804] selection:text-white">
      {/* Background Grids & Orbs */}
      <div className="absolute inset-0 bg-grid-pattern opacity-100 pointer-events-none z-0" />
      <div className="glow-orb animate-pulse-glow w-[500px] h-[500px] bg-white/10 top-[-100px] left-[10%] pointer-events-none" />
      <div className="glow-orb animate-pulse-glow w-[600px] h-[600px] bg-[#b83804]/5 top-[30%] right-[5%] pointer-events-none" style={{ animationDelay: "2s" }} />
      <div className="glow-orb animate-pulse-glow w-[400px] h-[400px] bg-white/5 bottom-[10%] left-[20%] pointer-events-none" style={{ animationDelay: "4s" }} />

      {/* Navigation Header */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 h-20 flex justify-between items-center border-b border-[#121212] backdrop-blur-xl bg-[#7a7dcd]/80">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-[#b83804] border border-[#121212] flex items-center justify-center shadow-xs">
            <Cpu className="h-5 w-5 text-white" />
          </div>
          <span className="font-extrabold text-xl tracking-tight text-[#121212]">
            SkillWise<span className="text-[#b83804] font-semibold">.ai</span>
          </span>
        </div>
        
        <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-[#121212]">
          <a href="#features" className="hover:text-[#b83804] transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-[#b83804] transition-colors">How it Works</a>
          <a href="#simulator" className="hover:text-[#b83804] transition-colors">Simulator</a>
          <a href="#github-connect" className="text-[#b83804] hover:text-[#b83804]/80 transition-colors font-bold">Start Interview</a>
        </nav>

        <div>
          <a 
            href="#github-connect"
            className="px-4 py-2.5 text-xs font-bold rounded-xl bg-[#dfdcce] border border-[#121212] hover:bg-[#cfcbae] text-[#121212] transition-all shadow-xs"
          >
            Start Free Practice
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-6 py-12 md:py-20 flex flex-col gap-24">
        
        {/* HERO SECTION */}
        <section className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16 pt-4">
          {/* Left Column: Heading and GitHub submission */}
          <div className="flex-1 flex flex-col items-start text-left max-w-2xl">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#dfdcce] border border-[#121212] text-[11px] font-bold text-[#b83804] mb-6 tracking-wide shadow-xs animate-float">
              <Sparkles className="h-3.5 w-3.5 text-[#b83804]" />
              <span>Introducing SkillWise AI 1.0</span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#121212] leading-[1.15] mb-6">
              Your Personal AI <br />
              <span className="text-[#b83804] drop-shadow-xs">
                Technical Interviewer
              </span>
            </h1>

            {/* Paragraph description */}
            <p className="text-[#121212]/85 text-base sm:text-lg font-semibold leading-relaxed mb-8">
              Turn your GitHub repositories into high-fidelity technical mock interviews. 
              Our AI scraper analyzes your codebase structure, understands your actual tech stack, 
              and runs interactive voice-based simulations custom-built for your profile.
            </p>

            {/* Interactive GitHub URL Collector Card */}
            <div id="github-connect" className="w-full border-brutalist-sand p-6 md:p-8 rounded-2xl shadow-xs relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,90,26,0.06)_0,transparent_50%)] pointer-events-none" />
              
              <h3 className="text-[#121212] font-extrabold text-lg mb-2 flex items-center gap-2">
                <Github className="h-5 w-5 text-[#b83804]" />
                Analyze Codebase & Start Mock Session
              </h3>
              <p className="text-[#121212]/80 text-xs mb-6">
                Enter your GitHub username or profile URL below. Our system builds a structural evaluation profile based on your public projects.
              </p>

              {step === "username" ? (
                <form onSubmit={handleFetchRepos} className="space-y-4">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <span className="text-[#121212]/60 text-xs font-bold">github.com/</span>
                    </div>
                    <input
                      type="text"
                      value={github}
                      onChange={(e) => handleGithubChange(e.target.value)}
                      placeholder="username"
                      disabled={fetchingRepos}
                      className="w-full bg-[#e6e4d5] border border-[#121212] rounded-xl pl-[96px] pr-4 py-3.5 text-sm text-[#121212] placeholder-stone-500/50 focus:outline-none focus:border-[#b83804] focus:ring-1 focus:ring-[#b83804]/30 transition-all font-semibold"
                    />
                  </div>
                  {validationError && (
                    <p className="text-red-650 text-xs font-bold mt-1 flex items-center gap-1">
                      ● {validationError}
                    </p>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-extrabold text-[#121212] block">
                      Upload Resume (PDF or TXT, optional)
                    </label>
                    <div className="relative border-2 border-dashed border-[#121212]/30 hover:border-[#b83804] rounded-xl p-4 bg-[#e6e4d5] hover:bg-[#dfdcce] transition-all flex flex-col items-center justify-center cursor-pointer group">
                      <input 
                        type="file" 
                        accept=".pdf,.txt" 
                        onChange={handleFileChange}
                        disabled={fetchingRepos}
                        className="absolute inset-0 opacity-0 cursor-pointer disabled:pointer-events-none"
                      />
                      <FileText className="h-6 w-6 text-[#b83804] mb-2 group-hover:scale-110 transition-transform" />
                      {resumeFile ? (
                        <div className="text-center">
                          <p className="text-xs font-bold text-[#121212]">{resumeFile.name}</p>
                          <p className="text-[10px] text-stone-500 font-semibold mt-0.5">
                            {(resumeFile.size / 1024).toFixed(1)} KB • Click to change
                          </p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-xs font-bold text-stone-600">Drag & drop or click to upload</p>
                          <p className="text-[10px] text-stone-500 font-semibold mt-0.5">PDF or TXT up to 5MB</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={fetchingRepos}
                    className="w-full py-3.5 px-6 rounded-xl bg-[#b83804] hover:bg-[#962d03] text-white border border-[#121212] font-bold text-sm tracking-wide shadow-xs transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {fetchingRepos ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                        Scanning Repositories...
                      </>
                    ) : (
                      <>
                        Scan Repositories
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleStartInterview} className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#121212]/10 pb-3">
                    <button
                      type="button"
                      onClick={() => setStep("username")}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#e6e4d5] border border-[#121212] hover:bg-[#dfdcce] text-[10px] font-extrabold text-[#121212] transition-all"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 text-[#b83804]" />
                      Back
                    </button>
                    <span className="text-[11px] font-bold text-[#121212]/75 font-mono">
                      {github}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    <label className="text-xs font-extrabold text-[#121212] flex justify-between items-center">
                      <span>Select Important Repositories</span>
                      <span className="text-[10px] font-mono font-bold text-[#b83804] bg-[#b83804]/10 border border-[#b83804]/20 px-2 py-0.5 rounded">
                        {selectedRepos.length} / {repos?.length || 0}
                      </span>
                    </label>
                    
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-[#e6e4d5] border border-[#121212] hover:bg-[#dfdcce] text-[#121212] transition-all"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={handleDeselectAll}
                        className="px-2.5 py-1 text-[10px] font-extrabold rounded-md bg-[#e6e4d5] border border-[#121212] hover:bg-[#dfdcce] text-[#121212] transition-all"
                      >
                        Deselect All
                      </button>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#121212]/60" />
                      <input
                        type="text"
                        placeholder="Search repos by name or stack..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[#e6e4d5] border border-[#121212] rounded-lg pl-9 pr-3 py-2 text-xs text-[#121212] placeholder-stone-500/50 focus:outline-none focus:border-[#b83804] transition-all font-semibold"
                      />
                    </div>

                    <div className="max-h-60 overflow-y-auto custom-scrollbar pr-1 space-y-2 mt-2">
                      {repos && repos.filter(repo => 
                        repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
                        (repo.language && repo.language.toLowerCase().includes(searchQuery.toLowerCase()))
                      ).length > 0 ? (
                        repos.filter(repo => 
                          repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (repo.description && repo.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          (repo.language && repo.language.toLowerCase().includes(searchQuery.toLowerCase()))
                        ).map((repo) => {
                          const isChecked = selectedRepos.includes(repo.name);
                          return (
                            <div
                              key={repo.name}
                              onClick={() => handleToggleRepo(repo.name)}
                              className={`p-3 rounded-xl border border-[#121212] text-left cursor-pointer transition-all flex items-start gap-3 select-none ${
                                isChecked 
                                  ? "bg-[#b83804]/10 border-[#b83804] shadow-xs" 
                                  : "bg-[#e6e4d5] hover:bg-[#dfdcce] opacity-80"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}} 
                                className="mt-0.5 h-3.5 w-3.5 accent-[#b83804] flex-shrink-0 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-extrabold text-xs text-[#121212] truncate flex items-center gap-1.5">
                                    {repo.name}
                                    {repo.isContribution && (
                                      <span className="px-1.5 py-0.5 rounded bg-[#b83804]/20 border border-[#b83804]/30 text-[9px] font-extrabold text-[#b83804] uppercase tracking-wider flex-shrink-0">
                                        Contributed
                                      </span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px] font-bold text-[#121212]/75">
                                    {repo.language && (
                                      <span className="px-1.5 py-0.5 rounded bg-white/60 border border-[#121212]/15">
                                        {repo.language}
                                      </span>
                                    )}
                                    {repo.stars !== undefined && (
                                      <span className="flex items-center gap-0.5 bg-white/60 border border-[#121212]/15 px-1 py-0.5 rounded">
                                        <Star className="h-2.5 w-2.5 text-[#b83804] fill-[#b83804]/20" />
                                        {repo.stars}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {repo.description && (
                                  <p className="text-[10px] text-[#121212]/75 mt-1 font-semibold line-clamp-2 leading-relaxed">
                                    {repo.description}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="py-8 text-center text-xs font-semibold text-stone-500">
                          No matching repositories found.
                        </div>
                      )}
                    </div>
                  </div>

                  {validationError && (
                    <p className="text-red-650 text-xs font-bold mt-1 flex items-center gap-1">
                      ● {validationError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading || selectedRepos.length === 0}
                    className="w-full py-3.5 px-6 rounded-xl bg-[#b83804] hover:bg-[#962d03] text-white border border-[#121212] font-bold text-sm tracking-wide shadow-xs transition-all flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-white" />
                        Initializing Mock Session...
                      </>
                    ) : (
                      <>
                        Start Custom Interview
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              )}

              <div className="mt-5 flex items-center justify-between text-[11px] text-[#121212]/75 border-t border-[#121212]/15 pt-4">
                <span className="flex items-center gap-1.5 font-bold">
                  <Shield className="h-3 w-3 text-[#b83804]" />
                  Public repos read-only
                </span>
                <span className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="h-3 w-3 text-[#b83804]" />
                  Voice mock ready
                </span>
                <span className="flex items-center gap-1.5 font-bold">
                  <Activity className="h-3 w-3 text-[#b83804]" />
                  Free 100% evaluated
                </span>
              </div>
            </div>
          </div>

          {/* Right Column: Visual Dashboard / Live Preview */}
          <div id="simulator" className="flex-1 w-full lg:max-w-xl relative flex justify-center">
            {/* Background glowing sphere behind container */}
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-[#b83804]/15 to-white/10 opacity-25 blur-xl animate-pulse-glow pointer-events-none" />

            {/* Container */}
            <div className="w-full border-brutalist-sand rounded-2xl overflow-hidden shadow-xs relative">
              
              {/* Fake Menu bar */}
              <div className="bg-[#dfdcce] px-4 py-3 border-b border-[#121212] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/80 border border-[#121212]/30" />
                  <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80 border border-[#121212]/30" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#b83804]/80 border border-[#121212]/30" />
                </div>
                <div className="text-[10px] text-[#b83804] font-mono font-bold flex items-center gap-1.5 bg-white/40 px-3 py-1 rounded-md border border-[#121212]">
                  <Terminal className="h-3 w-3 text-[#b83804]" />
                  skillwise-dashboard.ai
                </div>
                <div className="w-6" />
              </div>

              {/* Simulated UI Content */}
              <div className="p-5 space-y-5">
                {/* 1. Codebase Scanner Simulation */}
                <div className="bg-[#e6e4d5] border border-[#121212]/30 p-4 rounded-xl font-mono text-xs text-[#121212] space-y-2.5 relative">
                  <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] text-[#b83804] font-bold">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#b83804] animate-ping" />
                    scanning...
                  </div>
                  
                  <p className="text-[#b83804] font-bold flex items-center gap-1.5">
                    <span>$</span> analyze --github-profile=vartika6451
                  </p>
                  
                  <div className="space-y-1 text-[#121212]/85 text-[11px] leading-relaxed font-semibold">
                    <p className="flex items-center gap-2">
                      <span className="text-[#b83804] font-bold">✓</span> Scraped 12 repositories
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-[#b83804] font-bold">✓</span> Detected stack: React, TypeScript, Bun, SQLite
                    </p>
                    <p className="flex items-center gap-2 text-[#b83804] font-bold">
                      <Sparkles className="h-3.5 w-3.5 text-[#b83804] animate-pulse" />
                      Generated 8 custom core mock questions
                    </p>
                  </div>
                </div>

                {/* 2. Interactive Voice Orb Simulator */}
                <div className="bg-[#e6e4d5] border border-[#121212]/30 p-5 rounded-xl flex flex-col items-center text-center space-y-4">
                  <p className="text-[10px] text-[#121212]/60 font-extrabold uppercase tracking-wider">Voice Mock Session</p>
                  
                  {/* Glowing Animated Audio Orb */}
                  <div className="relative flex items-center justify-center h-20 w-20">
                    <div className="absolute inset-0 bg-[#b83804]/15 rounded-full animate-ping pointer-events-none" />
                    <div className="absolute inset-2 bg-[#b83804]/20 rounded-full blur-xs animate-pulse-glow pointer-events-none" />
                    <div className="h-14 w-14 rounded-full bg-[#b83804] border border-[#121212] flex items-center justify-center text-white shadow-xs hover:scale-[1.03] transition-transform cursor-pointer">
                      <Mic className="h-6 w-6 text-white animate-pulse" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs text-[#121212] font-bold flex items-center justify-center gap-1.5">
                      <span>Interviewer AI</span> 
                      <span className="bg-[#b83804]/10 text-[#b83804] text-[9px] px-1.5 py-0.5 rounded border border-[#b83804]/30 font-mono font-bold">LIVE SPEECH</span>
                    </p>
                    <p className="text-[11px] text-[#121212]/80 italic max-w-sm font-semibold">
                      "Explain your implementation of the rate-limiter middleware. How does it manage memory consumption under high load?"
                    </p>
                  </div>

                  {/* Audio soundbar mimic */}
                  <div className="flex justify-center items-center gap-1 w-2/3 h-5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                      <span 
                        key={i} 
                        className={`w-0.5 rounded-full bg-[#b83804] transition-all ${
                          i % 3 === 0 ? "h-3" : i % 2 === 0 ? "h-4" : "h-2"
                        } animate-pulse`} 
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
                      />
                    ))}
                  </div>
                </div>

                {/* 3. Performance Scoring & Evaluation preview */}
                <div className="bg-[#e6e4d5] border border-[#121212]/30 p-4 rounded-xl grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center justify-center bg-[#dfdcce] border border-[#121212] p-2.5 rounded-lg text-center shadow-xs">
                    <span className="text-[9px] text-[#121212]/60 font-extrabold uppercase tracking-wider mb-1">Score</span>
                    <span className="text-lg font-extrabold text-[#b83804] font-mono">87/100</span>
                  </div>
                  
                  <div className="flex flex-col items-center justify-center bg-[#dfdcce] border border-[#121212] p-2.5 rounded-lg text-center shadow-xs">
                    <span className="text-[9px] text-[#121212]/60 font-extrabold uppercase tracking-wider mb-1">Architecture</span>
                    <span className="text-xs font-bold text-[#121212]">Advanced</span>
                  </div>

                  <div className="flex flex-col items-center justify-center bg-[#dfdcce] border border-[#121212] p-2.5 rounded-lg text-center shadow-xs">
                    <span className="text-[9px] text-[#121212]/60 font-extrabold uppercase tracking-wider mb-1">Focus</span>
                    <span className="text-[9px] font-bold text-[#b83804]">Scalability</span>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </section>

        {/* TRUST LOGO CLOUD */}
        <section className="text-center space-y-6 pt-6 relative border-t border-[#121212]/20">
          <p className="text-[10px] sm:text-xs text-[#121212]/60 font-bold tracking-[0.2em] uppercase">
            Designed for engineers interviewing at elite organizations
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-75 hover:opacity-100 transition-opacity">
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">Y Combinator</span>
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">Vercel</span>
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">Linear</span>
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">Stripe</span>
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">Perplexity</span>
            <span className="font-bold text-sm sm:text-base text-[#121212]/60 hover:text-[#b83804] transition-colors cursor-default tracking-wide font-mono">OpenAI</span>
          </div>
        </section>

        {/* HOW IT WORKS SECTION */}
        <section id="how-it-works" className="space-y-16 py-8">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold tracking-tight text-[#121212] sm:text-4xl">
              Turn Your Repositories Into Real Practice
            </h2>
            <p className="text-[#121212]/80 text-sm sm:text-base font-semibold">
              A comprehensive three-stage assessment workflow built entirely around your engineering patterns.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Step 1 */}
            <div className="border-glow-teal p-6 rounded-2xl relative space-y-4 border-brutalist-sand hover:border-[#b83804] transition-all">
              <div className="absolute top-6 right-6 font-mono text-3xl font-extrabold text-[#b83804]/20">01</div>
              <div className="h-10 w-10 rounded-xl bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                <Github className="h-5 w-5" />
              </div>
              <h4 className="text-[#121212] font-bold text-base">Connect GitHub Profile</h4>
              <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                Provide your GitHub handle. Our AI builds a technical blueprint of your repositories, languages, and dependencies.
              </p>
            </div>

            {/* Step 2 */}
            <div className="border-glow-teal p-6 rounded-2xl relative space-y-4 border-brutalist-sand hover:border-[#b83804] transition-all">
              <div className="absolute top-6 right-6 font-mono text-3xl font-extrabold text-[#b83804]/20">02</div>
              <div className="h-10 w-10 rounded-xl bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                <Mic className="h-5 w-5" />
              </div>
              <h4 className="text-[#121212] font-bold text-base">Conduct Voice Interview</h4>
              <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                Engage in an interactive vocal mock session. The AI synthesizes logical follow-ups based on code quality and architecture decisions.
              </p>
            </div>

            {/* Step 3 */}
            <div className="border-glow-teal p-6 rounded-2xl relative space-y-4 border-brutalist-sand hover:border-[#b83804] transition-all">
              <div className="absolute top-6 right-6 font-mono text-3xl font-extrabold text-[#b83804]/20">03</div>
              <div className="h-10 w-10 rounded-xl bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                <FileText className="h-5 w-5" />
              </div>
              <h4 className="text-[#121212] font-bold text-base">Hiring Evaluation Report</h4>
              <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                Receive detailed scorecards detailing algorithmic strength, system design choices, and targeted recommendations for improvement.
              </p>
            </div>
          </div>
        </section>

        {/* FEATURES GRID SECTION */}
        <section id="features" className="space-y-16 py-8">
          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <h2 className="text-3xl font-extrabold tracking-tight text-[#121212] sm:text-4xl">
              Engineered for High Trust & High Fidelity
            </h2>
            <p className="text-[#121212]/80 text-sm sm:text-base font-semibold">
              Say goodbye to generic LeetCode puzzles. Practice interviews tailored to what you actually build.
            </p>
          </div>

          {/* Bento-style Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
            
            {/* Bento Card 1: AI Codebase Audit (Col Span 3) */}
            <div className="md:col-span-3 border-brutalist-sand p-8 rounded-2xl flex flex-col justify-between hover:border-[#b83804] transition-all">
              <div className="space-y-4">
                <div className="h-9 w-9 rounded-lg bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                  <Cpu className="h-5 w-5" />
                </div>
                <h3 className="text-[#121212] font-bold text-lg">AI-Powered Stack Parsing</h3>
                <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                  Our system reviews directory structures, codebase dependencies, and specific implementations. It configures the interviewer engine to grill you on performance thresholds, stack gotchas, and refactoring techniques.
                </p>
              </div>
              <div className="mt-8 border-t border-[#121212]/10 pt-4 flex gap-4 text-[11px] text-[#121212]/70 font-mono font-bold">
                <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#b83804]" /> AST parsing</span>
                <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#b83804]" /> Dependency tracing</span>
              </div>
            </div>

            {/* Bento Card 2: Voice simulation (Col Span 3) */}
            <div className="md:col-span-3 border-brutalist-sand p-8 rounded-2xl flex flex-col justify-between hover:border-[#b83804] transition-all">
              <div className="space-y-4">
                <div className="h-9 w-9 rounded-lg bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                  <Mic className="h-5 w-5" />
                </div>
                <h3 className="text-[#121212] font-bold text-lg">Conversational Voice Mock</h3>
                <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                  Practice vocal responses in a natural environment. Integrated Speech Synthesis and Recognition lets you converse with the AI directly. Experience spontaneous, dynamically formulated follow-up questions tailored to your comments.
                </p>
              </div>
              <div className="mt-8 border-t border-[#121212]/10 pt-4 flex gap-4 text-[11px] text-[#121212]/70 font-mono font-bold">
                <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#b83804]" /> Natural Voice (TTS)</span>
                <span className="flex items-center gap-1"><Check className="h-3 w-3 text-[#b83804]" /> Audio wave visualizer</span>
              </div>
            </div>

            {/* Bento Card 3: Performance Assessment scoring (Col Span 2) */}
            <div className="md:col-span-2 border-brutalist-sand p-6 rounded-2xl flex flex-col justify-between hover:border-[#b83804] transition-all">
              <div className="space-y-3">
                <div className="h-8 w-8 rounded-lg bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                  <BarChart3 className="h-4.5 w-4.5" />
                </div>
                <h3 className="text-[#121212] font-bold text-base">Hiring Scorecard</h3>
                <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                  Evaluate your performance with a standardized hiring-style report card covering Code Quality, Scalability, Algorithms, and verbal communication.
                </p>
              </div>
            </div>

            {/* Bento Card 4: Technical evaluation metrics (Col Span 2) */}
            <div className="md:col-span-2 border-brutalist-sand p-6 rounded-2xl flex flex-col justify-between hover:border-[#b83804] transition-all">
              <div className="space-y-3">
                <div className="h-8 w-8 rounded-lg bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                  <TrendingUp className="h-4.5 w-4.5" />
                </div>
                <h3 className="text-[#121212] font-bold text-base">Performance Analytics</h3>
                <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                  Understand your technical benchmarks. Find out whether your projects map to junior, mid-level, or senior hiring criteria.
                </p>
              </div>
            </div>

            {/* Bento Card 5: Improvement Areas (Col Span 2) */}
            <div className="md:col-span-2 border-brutalist-sand p-6 rounded-2xl flex flex-col justify-between hover:border-[#b83804] transition-all">
              <div className="space-y-3">
                <div className="h-8 w-8 rounded-lg bg-[#e6e4d5] border border-[#121212] flex items-center justify-center text-[#b83804]">
                  <Award className="h-4.5 w-4.5" />
                </div>
                <h3 className="text-[#121212] font-bold text-base">Targeted Feedback</h3>
                <p className="text-[#121212]/80 text-xs leading-relaxed font-semibold">
                  Identify syntax weaknesses, gaps in testing coverage, and concurrency issues, and receive precise project recommendations.
                </p>
              </div>
            </div>

          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full mt-24 border-t border-[#121212] bg-[#dfdcce] py-12 text-[#121212]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-[#b83804] border border-[#121212] flex items-center justify-center shadow-sm">
              <Cpu className="h-4 w-4 text-white" />
            </div>
            <span className="font-extrabold text-md tracking-tight text-[#121212]">
              SkillWise<span className="text-[#b83804] font-semibold">.ai</span>
            </span>
          </div>

          <p className="text-[#121212]/70 text-xs font-bold">
            © {new Date().getFullYear()} SkillWise.ai. All rights reserved. Premium Mock Sandbox.
          </p>

          <div className="flex items-center gap-6 text-xs text-[#121212]/80 font-bold">
            <a href="#features" className="hover:text-[#b83804] transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-[#b83804] transition-colors">How it Works</a>
            <span className="text-[#121212]/20">|</span>
            <span className="text-[#121212] flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-[#b83804]" />
              US East Sandbox
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}