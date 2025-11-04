import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const results = await request.json()
    console.log('📄 PDF Generation - Received data:', JSON.stringify(results, null, 2))
    
    // Validate required fields
    if (!results['Student Name'] && !results.studentName) {
      console.error('❌ Missing Student Name in PDF data')
      return NextResponse.json({ error: 'Missing student name' }, { status: 400 })
    }
    
    // Launch Chromium in a serverless-friendly way on Vercel, and use Puppeteer locally
    const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME
    let browser: any

    if (isServerless) {
      // Vercel / Lambda: use puppeteer-core + @sparticuz/chromium
      const chromium = (await import('@sparticuz/chromium')).default
      const puppeteerCore = (await import('puppeteer-core')).default

  // Prefer chromium's bundled executable path for serverless; fall back to env if needed
  const chromiumPath = await chromium.executablePath()
  const executablePath = chromiumPath || process.env.PUPPETEER_EXECUTABLE_PATH

      browser = await puppeteerCore.launch({
        args: chromium.args,
        executablePath,
        headless: true,
        timeout: 30000,
      })
    } else {
      // Local dev: use full puppeteer (downloads Chrome on install)
      const puppeteer = (await import('puppeteer')).default
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        timeout: 30000
      })
    }
    
    const page = await browser.newPage()
    
    // Set page timeout
    page.setDefaultTimeout(30000) // 30 second timeout
    page.setDefaultNavigationTimeout(30000)
    
    // Generate HTML content for the PDF
    const htmlContent = generateHTMLContent(results)
    console.log('📄 Generated HTML content length:', htmlContent.length)
    
    // Set viewport size to A4 dimensions
    await page.setViewport({
      width: 794, // A4 width in pixels at 96 DPI
      height: 1123, // A4 height in pixels at 96 DPI
    });

    // Enable print and background colors
    await page.emulateMediaType('print');

    // Set content with better wait conditions
    await page.setContent(htmlContent, { 
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 30000 
    });

    // Additional time for CSS animations and renders
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('📄 Page content loaded successfully');
    
    // Wait for any dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Generate PDF - no fallback, errors will be returned to user
    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        },
        timeout: 30000, // 30 second timeout for PDF generation
        scale: 1.0, // Ensure 100% scale
        landscape: false
    });
    
    console.log('📄 PDF generated, buffer size:', pdfBuffer.length)
    
    // Validate PDF buffer
    if (pdfBuffer.length === 0) {
      console.error('❌ PDF buffer is empty');
      await browser.close();
      return NextResponse.json({ error: 'PDF generation failed - empty buffer' }, { status: 500 });
    }
    
  await browser.close()
    
    console.log('📄 Returning PDF response with size:', pdfBuffer.length)
    
    // Return PDF as response - use Response constructor for binary data
    return new Response(pdfBuffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="psychometric-report-${(results['Student Name'] || results.studentName).replace(/\s+/g, '-').toLowerCase()}.pdf"`
      }
    })
  } catch (error) {
    console.error('Error generating PDF:', error)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}

function generateHTMLContent(results: any): string {
  const currentDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Get data from LLM format - no fallbacks, use actual data only
  const studentName = results['Student Name'] || results.studentName;
  const studentEmail = results['Student Email'] || results.studentEmail || results.userEmail || '';
  const studentPhone = results['Student Phone'] || results.studentPhone || results.userPhone || '';
  
  // Validate required fields
  if (!studentName) {
    throw new Error('Student Name is required');
  }
  
  // Get scores object - validate it exists
  const scoresRaw = results.scores || results.Scores || results['Scores'];
  if (!scoresRaw) {
    throw new Error('Scores data is required');
  }
  
  // Helper function to parse scores and ensure they are numbers
  const parseScore = (score: any): number => {
    if (typeof score === 'number') return Math.round(score);
    if (typeof score === 'string') {
      // Remove any % signs and non-numeric characters, then convert to number
      const cleaned = score.replace(/[^\d.]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : Math.round(num);
    }
    return 0;
  };
  
  // Extract individual scores with parsing
  const scores = {
    'Financial Planning': parseScore(scoresRaw['Financial Planning']),
    'Academic Readiness': parseScore(scoresRaw['Academic Readiness']),
    'Career Alignment': parseScore(scoresRaw['Career Alignment']),
    'Personal & Cultural': parseScore(scoresRaw['Personal & Cultural']),
    'Practical Readiness': parseScore(scoresRaw['Practical Readiness']),
    'Support System': parseScore(scoresRaw['Support System'])
  };
  
  // Validate required scores exist and parse Overall Index
  const overallIndexRaw = results['Overall Readiness Index'] || results.overallIndex;
  if (overallIndexRaw === undefined) {
    throw new Error('Overall Readiness Index is required');
  }
  const overallIndex = parseScore(overallIndexRaw);
  
  const readinessLevel = results['Readiness Level'] || results.readinessLevel;
  if (!readinessLevel) {
    throw new Error('Readiness Level is required');
  }
  
  const strengths = results.Strengths;
  if (!strengths) {
    throw new Error('Strengths analysis is required');
  }
  
  const gaps = results.Gaps;
  if (!gaps) {
    throw new Error('Gaps analysis is required');
  }
  
  const recommendations = results.Recommendations;
  if (!recommendations) {
    throw new Error('Recommendations are required');
  }
  
  const countryFit = results['Country Fit (Top 3)'] || [];

  // Helper to format text into bullet points
  const formatToBulletPoints = (text: string | string[] | undefined) => {
    if (!text) {
      return `<li class="bullet-item">Information not available</li>`;
    }

    // Handle array input
    if (Array.isArray(text)) {
      return text.map(item => `<li class="bullet-item">${item.trim()}</li>`).join('');
    }

    // Handle string input
    if (typeof text === 'string') {
      if (text === 'No strengths identified' || text === 'No gaps identified' || text === 'No recommendations provided') {
        return `<li class="bullet-item">Information not available</li>`;
      }

      // Split by common delimiters and create bullet points
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const points = sentences.length > 1 ? sentences : text.split(/[,;]+/).filter(s => s.trim().length > 0);

      return points.map(point => {
        const cleanPoint = point.trim().replace(/^\d+\.?\s*/, ''); // Remove leading numbers
        return `<li class="bullet-item">${cleanPoint}</li>`;
      }).join('');
    }

    // Handle any other type
    return `<li class="bullet-item">Invalid input format</li>`;
  };

  // Helper to get weight for a framework
  const getFrameworkWeight = (framework: string) => {
    switch (framework) {
      case 'Financial Planning': return '25%';
      case 'Academic Readiness': return '20%';
      case 'Career Alignment': return '20%';
      case 'Personal & Cultural': return '15%';
      case 'Practical Readiness': return '10%';
      case 'Support System': return '10%';
      default: return '0%';
    }
  };

  // Helper to generate SVG icons
  const generateCheckIcon = () => {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 6L9 17L4 12" stroke="#2ECC71" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };
  
  const generateWarningIcon = () => {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#F1C40F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };
  
  const generateArrowIcon = () => {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12H19M19 12L12 5M19 12L12 19" stroke="#0066CC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  };
  const generateScoreCard = (label: string, score: number | string, weight: string) => {
    // Ensure we have a clean numeric value
    let cleanScore: number;
    if (typeof score === 'number') {
      cleanScore = Math.round(score);
    } else if (typeof score === 'string') {
      // Remove % and any non-numeric characters
      const cleaned = score.replace(/[^\d.]/g, '');
      cleanScore = Math.round(parseFloat(cleaned) || 0);
    } else {
      cleanScore = 0;
    }
    
    const barClass = cleanScore >= 80 ? 'excellent' : cleanScore >= 60 ? 'good' : cleanScore >= 40 ? 'average' : 'weak';
    
    return `
      <div class="score-card">
        <h4>${label}</h4>
        <div class="score-value"><span class="score-number">${cleanScore}</span><span class="percent-symbol">%</span></div>
        <div class="score-bar">
          <div class="score-fill ${barClass}" style="width: ${cleanScore}%"></div>
        </div>
      </div>
    `;
  };

  // Helper to generate circular progress chart for overall readiness index
  const generateCircularProgressChart = (score: number, readinessLevel: string) => {
    const size = 140; // Reduced size for better fit
    const radius = 55; // Adjusted radius
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    const center = size / 2;
    
    // Determine color based on score
    const color = score >= 80 ? '#2ECC71' : score >= 60 ? '#2ECC71' : score >= 40 ? '#F1C40F' : '#ef4444';
    
    return `
      <div class="circular-progress-container">
        <svg class="circular-progress-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <!-- Background circle -->
          <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="8" opacity="0.3"/>
          <!-- Progress circle -->
          <circle 
            cx="${center}" 
            cy="${center}" 
            r="${radius}" 
            fill="none" 
            stroke="${color}" 
            stroke-width="10"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}"
            stroke-linecap="round"
            transform="rotate(-90 ${center} ${center})"
            style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));"
          />
          <!-- Center text -->
          <text x="${center}" y="${center - 8}" text-anchor="middle" dominant-baseline="middle" 
                font-size="28" font-weight="900" fill="${color}" font-family="Poppins, sans-serif">${score}%</text>
          <text x="${center}" y="${center + 18}" text-anchor="middle" dominant-baseline="middle" 
                font-size="11" font-weight="700" fill="#64748b" font-family="Poppins, sans-serif" letter-spacing="1px">CRI</text>
        </svg>
        <div class="readiness-level-badge">
          <span class="readiness-level-text">${readinessLevel}</span>
        </div>
      </div>
    `;
  };

  // Helper to generate full-page radar chart with SVG visualization and colored legend
  const generateRadarChart = (scores: any) => {
    const categories = [
      { name: 'Financial Planning', short: 'Financial', icon: '💰', score: parseScore(scores['Financial Planning']), color: '#ef4444' },
      { name: 'Academic Readiness', short: 'Academic', icon: '📚', score: parseScore(scores['Academic Readiness']), color: '#3b82f6' },
      { name: 'Career Alignment', short: 'Career', icon: '🎯', score: parseScore(scores['Career Alignment']), color: '#8b5cf6' },
      { name: 'Personal & Cultural', short: 'Cultural', icon: '🌍', score: parseScore(scores['Personal & Cultural']), color: '#10b981' },
      { name: 'Practical Readiness', short: 'Practical', icon: '⚙️', score: parseScore(scores['Practical Readiness']), color: '#f59e0b' },
      { name: 'Support System', short: 'Support', icon: '🤝', score: parseScore(scores['Support System']), color: '#06b6d4' }
    ];
    
    // Generate SVG radar chart - smaller size to fit with score cards on one page
    const size = 350; // Reduced size to fit with score cards
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.32; // Adjusted radius
    const angleStep = (2 * Math.PI) / categories.length;
    
    // Calculate points for radar polygon with individual colors per segment
    const polygonSegments = categories.map((cat, index) => {
      const angle = (index * angleStep) - Math.PI / 2;
      const nextAngle = ((index + 1) % categories.length) * angleStep - Math.PI / 2;
      const distance = (cat.score / 100) * radius;
      const nextDistance = (categories[(index + 1) % categories.length].score / 100) * radius;
      
      const x1 = centerX + Math.cos(angle) * distance;
      const y1 = centerY + Math.sin(angle) * distance;
      const x2 = centerX + Math.cos(nextAngle) * nextDistance;
      const y2 = centerY + Math.sin(nextAngle) * nextDistance;
      
      return `<polygon points="${centerX},${centerY} ${x1},${y1} ${x2},${y2}" 
                        fill="${cat.color}" 
                        fill-opacity="0.15" 
                        stroke="${cat.color}" 
                        stroke-width="2"/>`;
    }).join('');
    
    // Calculate points for main radar polygon
    const points = categories.map((cat, index) => {
      const angle = (index * angleStep) - Math.PI / 2;
      const distance = (cat.score / 100) * radius;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      return `${x},${y}`;
    }).join(' ');
    
    // Generate axis lines and labels
    const axes = categories.map((cat, index) => {
      const angle = (index * angleStep) - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const labelX = centerX + Math.cos(angle) * (radius + 35);
      const labelY = centerY + Math.sin(angle) * (radius + 35);
      
      return `
        <line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" 
              stroke="${cat.color}" stroke-width="2" opacity="0.5"/>
        <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" 
              font-size="12" font-weight="700" fill="${cat.color}" font-family="Poppins, sans-serif">${cat.short}</text>
      `;
    }).join('');
    
    // Generate concentric circles for scale
    const circles = [0.25, 0.5, 0.75, 1].map(scale => {
      const r = radius * scale;
      return `<circle cx="${centerX}" cy="${centerY}" r="${r}" 
                      fill="none" stroke="#e5e7eb" stroke-width="1.5" opacity="0.4"/>`;
    }).join('');
    
    // Determine overall fill color based on average score
    const avgScore = categories.reduce((sum, cat) => sum + cat.score, 0) / categories.length;
    const overallColor = avgScore >= 80 ? '#2ECC71' : avgScore >= 60 ? '#2ECC71' : avgScore >= 40 ? '#F1C40F' : '#ef4444';
    
    return `
      <div class="radar-chart-full-page">
        <svg class="radar-chart-svg-full" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${circles}
          ${polygonSegments}
          ${axes}
          <polygon points="${points}" 
                   fill="${overallColor}" 
                   fill-opacity="0.1" 
                   stroke="${overallColor}" 
                   stroke-width="4"/>
          ${categories.map((cat, index) => {
            const angle = (index * angleStep) - Math.PI / 2;
            const distance = (cat.score / 100) * radius;
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            return `<circle cx="${x}" cy="${y}" r="8" fill="${cat.color}" stroke="white" stroke-width="2.5"/>`;
          }).join('')}
        </svg>
        <div class="radar-legend-enhanced">
          ${categories.map(category => `
            <div class="radar-legend-item" style="border-left-color: ${category.color};">
              <span class="radar-legend-icon">${category.icon}</span>
              <span class="radar-legend-color" style="background-color: ${category.color};"></span>
              <span class="radar-legend-label">${category.name}</span>
              <span class="radar-legend-score">${category.score}%</span>
      </div>
          `).join('')}
        </div>
      </div>
    `;
  };

  // Helper to generate trend chart
  const generateTrendChart = (scores: any) => {
    const categories = [
      { name: 'Financial', score: parseScore(scores['Financial Planning']) },
      { name: 'Academic', score: parseScore(scores['Academic Readiness']) },
      { name: 'Career', score: parseScore(scores['Career Alignment']) },
      { name: 'Cultural', score: parseScore(scores['Personal & Cultural']) },
      { name: 'Practical', score: parseScore(scores['Practical Readiness']) },
      { name: 'Support', score: parseScore(scores['Support System']) }
    ];
    
    return categories.map(category => `
      <div class="trend-bar">
        <div class="trend-label">${category.name}</div>
        <div class="trend-progress">
          <div class="trend-fill" style="width: ${category.score}%"></div>
        </div>
        <div class="trend-value">${category.score}%</div>
      </div>
    `).join('');
  };

  // Helper to format description text into bullet points for country matrix
  const formatDescriptionToBullets = (text: string): string => {
    if (!text) return '<div class="country-matrix-text"><ul class="country-bullet-list"><li>Good study destination</li></ul></div>';
    
    // Clean up the text
    const cleanedText = text
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // Split into sentences - each sentence becomes its own bullet point
    const sentences = cleanedText.split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.match(/^\s*$/))
      .filter(s => s.length > 10); // Filter out very short fragments
    
    // If sentences are too long, split further by commas or conjunctions
    const bulletPoints: string[] = [];
    sentences.forEach(sentence => {
      // If sentence is very long (more than 120 chars), try to split it
      if (sentence.length > 120) {
        // Split by common connectors
        const parts = sentence.split(/\s+(and|with|due to|because|,)\s+/i);
        parts.forEach(part => {
          const trimmed = part.trim();
          if (trimmed.length > 10 && trimmed.length < 100) {
            bulletPoints.push(trimmed + (trimmed.endsWith('.') ? '' : '.'));
          }
        });
      } else {
        // Keep as single bullet if reasonable length
        bulletPoints.push(sentence + (sentence.endsWith('.') ? '' : '.'));
      }
    });
    
    // Ensure we have at least one bullet
    if (bulletPoints.length === 0) {
      // Split by commas if no sentences found
      const commaSplit = cleanedText.split(',').map(s => s.trim()).filter(s => s.length > 10);
      if (commaSplit.length > 0) {
        bulletPoints.push(...commaSplit.map(s => s + (s.endsWith('.') ? '' : '.')));
      } else {
        bulletPoints.push(cleanedText);
      }
    }
    
    // Limit to 4-5 bullets max for readability
    const finalBullets = bulletPoints.slice(0, 5);
    
    return `
      <ul class="country-bullet-list">
        ${finalBullets.map(point => `<li class="country-bullet-item">${point}</li>`).join('')}
      </ul>
    `;
  };

  // Helper to extract country metrics from description
  const extractCountryMetrics = (description: string, country: string) => {
    const lowerDesc = description.toLowerCase();
    const lowerCountry = country.toLowerCase();
    
    // Determine tuition level
    let tuition = 'Moderate';
    if (lowerDesc.includes('affordable') || lowerDesc.includes('lower cost') || lowerDesc.includes('moderate cost') || lowerCountry.includes('ireland') || lowerCountry.includes('germany')) {
      tuition = 'Affordable';
    } else if (lowerDesc.includes('expensive') || lowerDesc.includes('high cost') || lowerDesc.includes('higher tuition') || lowerCountry.includes('usa') || lowerCountry.includes('uk')) {
      tuition = 'Higher';
    }
    
    // Determine community strength
    let community = 'Moderate';
    if (lowerDesc.includes('strong indian') || lowerDesc.includes('large indian') || lowerDesc.includes('indian diaspora') || lowerDesc.includes('welcoming') || lowerCountry.includes('canada') || lowerCountry.includes('uk') || lowerCountry.includes('australia')) {
      community = 'Strong';
    } else if (lowerDesc.includes('limited') || lowerDesc.includes('small')) {
      community = 'Growing';
    }
    
    // Determine support level
    let support = 'Good';
    if (lowerDesc.includes('excellent support') || lowerDesc.includes('robust support') || lowerDesc.includes('strong support') || lowerDesc.includes('extensive support')) {
      support = 'Excellent';
    } else if (lowerDesc.includes('limited support') || lowerDesc.includes('basic support')) {
      support = 'Basic';
    }
    
    // Determine language
    let language = 'English';
    if (lowerDesc.includes('french') || lowerCountry.includes('france') || lowerCountry.includes('canada') && lowerDesc.includes('bilingual')) {
      language = 'English/French';
    } else if (lowerDesc.includes('german') || lowerCountry.includes('germany')) {
      language = 'German/English';
    } else if (lowerDesc.includes('spanish') || lowerCountry.includes('spain')) {
      language = 'Spanish/English';
    }
    
    return { tuition, community, support, language };
  };

  // Helper to get rank badge color and icon
  const getRankBadge = (index: number) => {
    if (index === 0) {
      return { color: '#F1C40F', bgColor: '#FEF3C7', icon: '🥇', label: 'Top Choice' };
    } else if (index === 1) {
      return { color: '#94A3B8', bgColor: '#F1F5F9', icon: '🥈', label: 'Great Option' };
    } else {
      return { color: '#D97706', bgColor: '#FEF3C7', icon: '🥉', label: 'Good Fit' };
    }
  };

  // Helper to generate country cards grid
  const generateCountryCardsGrid = (countries: any[]) => {
    if (!countries || countries.length === 0) return '';
    
    return countries.map((countryData, index) => {
      const country = typeof countryData === 'string' ? countryData : countryData.country;
      const matchScore = typeof countryData === 'string' ? Math.round(100 - (index * 15)) : parseScore(countryData.match || 100);
      const description = typeof countryData === 'string' ? 'Well-suited destination for study abroad' : (countryData.reasoning || 'Good study destination');
      const challenges = typeof countryData === 'object' ? countryData.challenges : '';
      
      // Load country flag
      const countryFlag = loadCountryFlagSVG(country);
      
      // Extract metrics
      const metrics = extractCountryMetrics(description, country);
      
      // Get rank badge
      const rankBadge = getRankBadge(index);
      
      // Determine match strength
      const matchStrength = matchScore >= 80 ? 'Strong Fit' : matchScore >= 70 ? 'Good Fit' : matchScore >= 60 ? 'Moderate Fit' : 'Fair Fit';
      
    // Get fit summary (first sentence from description) - do not truncate to avoid abrupt cutoffs
    const fitSummary = description.split('.')[0];
      
      // Determine progress bar color
      const progressColor = matchScore >= 80 ? '#2ECC71' : matchScore >= 70 ? '#F1C40F' : '#0066CC';
      
      return `
        <div class="country-card-grid">
          <!-- Rank Badge -->
          <div class="country-rank-badge" style="background-color: ${rankBadge.bgColor}; border-color: ${rankBadge.color};">
            ${medalImageDataURI ? `<img src="${medalImageDataURI}" alt="Medal" class="rank-medal-img"/>` : `<span class=\"rank-icon\">${rankBadge.icon}</span>`}
            <span class="rank-number">#${index + 1}</span>
          </div>
          
          <!-- Header Section -->
          <div class="country-card-header">
            <div class="country-flag-section">
              ${countryFlag}
            </div>
            <div class="country-title-section">
              <h3 class="country-card-name">${country}</h3>
              <div class="country-match-info">
                <span class="match-percentage">${matchScore}% Match</span>
                <span class="match-divider">|</span>
                <span class="match-strength">${matchStrength}</span>
              </div>
            </div>
          </div>
          
          <!-- Progress Bar -->
          <div class="country-progress-container">
            <div class="country-progress-bar">
              <div class="country-progress-fill" style="width: ${matchScore}%; background-color: ${progressColor};"></div>
            </div>
          </div>
          
          <!-- Metrics Grid -->
          <div class="country-metrics-grid">
            <div class="country-metric-item" data-metric="tuition">
              <span class="metric-icon">🎓</span>
              <div class="metric-content">
                <span class="metric-label">Tuition</span>
                <span class="metric-value">${metrics.tuition}</span>
              </div>
            </div>
            <div class="country-metric-item" data-metric="community">
              <span class="metric-icon">🌍</span>
              <div class="metric-content">
                <span class="metric-label">Community</span>
                <span class="metric-value">${metrics.community}</span>
              </div>
            </div>
            <div class="country-metric-item" data-metric="support">
              <span class="metric-icon">🤝</span>
              <div class="metric-content">
                <span class="metric-label">Support</span>
                <span class="metric-value">${metrics.support}</span>
              </div>
            </div>
            <div class="country-metric-item" data-metric="language">
              <span class="metric-icon">💬</span>
              <div class="metric-content">
                <span class="metric-label">Language</span>
                <span class="metric-value">${metrics.language}</span>
              </div>
            </div>
          </div>
          
          <!-- Fit Summary -->
          <div class="country-fit-summary">
            <div class="fit-summary-icon">💡</div>
            <div class="fit-summary-content">
              <span class="fit-summary-label">Fit Summary:</span>
              <p class="fit-summary-text">${fitSummary}</p>
            </div>
          </div>
          
          ${challenges ? `
          <!-- Challenges Note -->
          <div class="country-challenges-note">
            <span class="challenges-icon">⚠️</span>
            <span class="challenges-text">${challenges}</span>
          </div>
          ` : ''}
        </div>
      `;
    }).join('');
  };

  // Helper to generate country matrix - now supports both string and object formats
  const generateCountryMatrix = (countries: any[]) => {
    return countries.map((countryData, index) => {
      // Handle both old format (string) and new format (object)
      const country = typeof countryData === 'string' ? countryData : countryData.country;
      let matchScore = typeof countryData === 'string' ? Math.round(100 - (index * 15)) : countryData.match || 100;
      matchScore = parseScore(matchScore); // Ensure it's a number
      const description = typeof countryData === 'string' ? 'Well-suited destination for study abroad' : (countryData.reasoning || 'Good study destination');
      
      // Load the country flag SVG
      const countryFlag = loadCountryFlagSVG(country);
      
      // Format description as bullet points
      const descriptionBullets = formatDescriptionToBullets(description);
      
      return `
        <div class="country-matrix-item">
          <div class="country-matrix-rank">#${index + 1}</div>
          <div class="country-matrix-flag">${countryFlag}</div>
          <div class="country-matrix-name">${country}</div>
          <div class="country-matrix-score">${matchScore}% Match</div>
          <div class="country-matrix-desc">${descriptionBullets}</div>
        </div>
      `;
    }).join('');
  };

  // Helper function to load SVG file and convert to base64 data URI
  const loadCountryFlagSVG = (countryName: string): string => {
    // Comprehensive map of country names to SVG file codes (ISO 3166-1 alpha-2 codes)
    const countryToCodeMap: { [key: string]: string } = {
      // Major Study Abroad Destinations
      'Singapore': 'sg',
      'Ireland': 'ie',
      'Netherlands': 'nl',
      'Holland': 'nl',
      'Canada': 'ca',
      'Australia': 'au',
      'United Kingdom': 'gb',
      'UK': 'gb',
      'U.K.': 'gb',
      'U.K': 'gb',
      'Britain': 'gb',
      'Great Britain': 'gb',
      'Germany': 'de',
      'Deutschland': 'de',
      'United States': 'us',
      'USA': 'us',
      'US': 'us',
      'U.S.A': 'us',
      'U.S.A.': 'us',
      'United States of America': 'us',
      'America': 'us',
      'India': 'in',
      'United Arab Emirates': 'ae',
      'UAE': 'ae',
      'New Zealand': 'nz',
      'France': 'fr',
      'Sweden': 'se',
      'Norway': 'no',
      'Denmark': 'dk',
      'Finland': 'fi',
      'Switzerland': 'ch',
      'Austria': 'at',
      'Belgium': 'be',
      'Italy': 'it',
      'Spain': 'es',
      'Portugal': 'pt',
      'Greece': 'gr',
      'Poland': 'pl',
      'Czech Republic': 'cz',
      'Hungary': 'hu',
      'Romania': 'ro',
      'Japan': 'jp',
      'South Korea': 'kr',
      'Korea': 'kr',
      'China': 'cn',
      'Hong Kong': 'hk',
      'Taiwan': 'tw',
      'Thailand': 'th',
      'Malaysia': 'my',
      'Indonesia': 'id',
      'Philippines': 'ph',
      'Vietnam': 'vn',
      'South Africa': 'za',
      'Brazil': 'br',
      'Mexico': 'mx',
      'Argentina': 'ar',
      'Chile': 'cl',
      'Turkey': 'tr',
      'Israel': 'il',
      'Saudi Arabia': 'sa',
      'Qatar': 'qa',
      'Kuwait': 'kw',
      'Oman': 'om',
      'Bahrain': 'bh',
      'Russia': 'ru',
      'Ukraine': 'ua',
      'Belarus': 'by',
      'Estonia': 'ee',
      'Latvia': 'lv',
      'Lithuania': 'lt',
      'Slovakia': 'sk',
      'Slovenia': 'si',
      'Croatia': 'hr',
      'Serbia': 'rs',
      'Bulgaria': 'bg',
      'Cyprus': 'cy',
      'Malta': 'mt',
      'Iceland': 'is',
      'Luxembourg': 'lu',
      'Monaco': 'mc',
      'Andorra': 'ad',
      'Liechtenstein': 'li',
      'San Marino': 'sm',
      'Vatican City': 'va',
      'Vatican': 'va'
    };

    // Normalize country name (case-insensitive, handle variations)
    const normalizedCountry = countryName?.trim() || '';
    const countryCode = Object.keys(countryToCodeMap).find(key =>
      key.toLowerCase() === normalizedCountry.toLowerCase() ||
      normalizedCountry.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(normalizedCountry.toLowerCase())
    );
    
    const code = countryCode ? countryToCodeMap[countryCode] : null;
    
    // If no code found, try to extract first two letters as fallback code
    if (!code) {
      // Try to find a match by checking if any country name starts with the normalized country
      const partialMatch = Object.keys(countryToCodeMap).find(key =>
        normalizedCountry.toLowerCase().startsWith(key.toLowerCase()) ||
        key.toLowerCase().startsWith(normalizedCountry.toLowerCase())
      );
      const finalCode = partialMatch ? countryToCodeMap[partialMatch] : null;
      
      if (!finalCode) {
        // Fallback: use first two letters as country code
        const fallbackCode = normalizedCountry.substring(0, 2).toLowerCase();
        return `<svg width="90" height="60" viewBox="0 0 100 60" class="country-map" preserveAspectRatio="xMidYMid meet"><rect width="100" height="60" fill="#3498db" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${fallbackCode.toUpperCase()}</text></svg>`;
      }
      
      // Use the partial match code
      const svgPath = path.join(process.cwd(), 'svg', `${finalCode}.svg`);
      if (fs.existsSync(svgPath)) {
        try {
          const svgContent = fs.readFileSync(svgPath, 'utf-8');
          const cleanedSVG = svgContent
            .replace(/<svg([^>]*)>/, `<svg width="90" height="60" $1 class="country-map" preserveAspectRatio="xMidYMid meet">`)
            .trim();
          return cleanedSVG;
        } catch (error) {
          console.error(`Error loading SVG for ${countryName}:`, error);
        }
      }
      
      // Final fallback
      return `<svg width="70" height="45" viewBox="0 0 100 60" class="country-map" preserveAspectRatio="xMidYMid meet"><rect width="100" height="60" fill="#3498db" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${normalizedCountry.substring(0, 2).toUpperCase()}</text></svg>`;
    }

    try {
      // Get the SVG file path - adjust path based on execution context
      const svgPath = path.join(process.cwd(), 'svg', `${code}.svg`);
      
      // Read SVG file
      if (fs.existsSync(svgPath)) {
        const svgContent = fs.readFileSync(svgPath, 'utf-8');
        // Clean the SVG content and add class, width, height for styling
        // Ensure width and height are set for consistent PDF rendering
        let cleanedSVG = svgContent.trim();
        
        // Remove existing width/height attributes if present, then add our own
        cleanedSVG = cleanedSVG.replace(/\s+width="[^"]*"/gi, '');
        cleanedSVG = cleanedSVG.replace(/\s+height="[^"]*"/gi, '');
        cleanedSVG = cleanedSVG.replace(/<svg([^>]*)>/, `<svg width="90" height="60" $1 class="country-map" preserveAspectRatio="xMidYMid meet">`);
        
        // Return the SVG directly embedded in HTML
        return cleanedSVG;
      } else {
        console.warn(`SVG file not found for country: ${countryName} (code: ${code})`);
        // Fallback with proper dimensions
        return `<svg width="90" height="60" viewBox="0 0 100 60" class="country-map" preserveAspectRatio="xMidYMid meet"><rect width="100" height="60" fill="#3498db" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${normalizedCountry.substring(0, 2).toUpperCase()}</text></svg>`;
      }
    } catch (error) {
      console.error(`Error loading SVG for ${countryName}:`, error);
      // Fallback with proper dimensions
      return `<svg width="70" height="45" viewBox="0 0 100 60" class="country-map" preserveAspectRatio="xMidYMid meet"><rect width="100" height="60" fill="#3498db" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${normalizedCountry.substring(0, 2).toUpperCase()}</text></svg>`;
    }
  };

  // Helper function to load AVIF logo and convert to base64 data URI
  const loadLogoAVIF = (): string => {
    try {
      const logoPath = path.join(process.cwd(), 'logo.avif');
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        const logoBase64 = logoBuffer.toString('base64');
        return `data:image/avif;base64,${logoBase64}`;
      } else {
        console.warn('Logo file not found, using fallback SVG');
        // Return a simple SVG fallback
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODUiIGhlaWdodD0iODUiIHZpZXdCb3g9IjAgMCAzMjAgODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJsb2dvR3JhZCIgeDE9IjAiIHk1PSIwIiB4Mj0iMzIwIiB5Mj0iODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMDAzQjhDIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNUJFOEI5Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHAgZD0iTTAgMCBMNzAgMCBMMzUgNjAgWiIgZmlsbD0idXJsKCNsb2dvR3JhZCkiIG9wYWNpdHk9IjAuOTUiLz48L3N2Zz4=';
      }
    } catch (error) {
      console.error('Error loading logo:', error);
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODUiIGhlaWdodD0iODUiIHZpZXdCb3g9IjAgMCAzMjAgODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJsb2dvR3JhZCIgeDE9IjAiIHk1PSIwIiB4Mj0iMzIwIiB5Mj0iODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBzdG9wLWNvbG9yPSIjMDAzQjhDIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNUJFOEI5Ii8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHAgZD0iTTAgMCBMNzAgMCBMMzUgNjAgWiIgZmlsbD0idXJsKCNsb2dvR3JhZCkiIG9wYWNpdHk9IjAuOTUiLz48L3N2Zz4=';
    }
  };

  // Load logo once
  const logoDataURI = loadLogoAVIF();

  // Helper to load a medal image from public and return as data URI
  const loadMedalImageURI = (): string | null => {
    const candidates = [
      path.join(process.cwd(), 'public', 'icons', 'medal.png'),
      path.join(process.cwd(), 'public', 'images', 'medal.png'),
      path.join(process.cwd(), 'public', 'medal.png'),
      path.join(process.cwd(), 'public', 'icons', 'medal.jpg'),
      path.join(process.cwd(), 'public', 'images', 'medal.jpg'),
      path.join(process.cwd(), 'public', 'medal.jpg'),
      path.join(process.cwd(), 'public', 'icons', 'medal.avif'),
      path.join(process.cwd(), 'public', 'images', 'medal.avif'),
      path.join(process.cwd(), 'public', 'medal.avif')
    ];
    for (const filePath of candidates) {
      try {
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.avif' ? 'image/avif' : 'application/octet-stream';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch {}
    }
    return null;
  };
  const medalImageDataURI = loadMedalImageURI();

  // Helper to generate compact country card with country map SVG - now supports both formats
  const generateCountryCard = (countryData: any, index: number) => {
    // Handle both old format (string) and new format (object)
    const country = typeof countryData === 'string' ? countryData : countryData.country;
    let matchScore = typeof countryData === 'string' ? Math.round(100 - (index * 15)) : countryData.match || 100;
    matchScore = parseScore(matchScore); // Ensure it's a number
    const universities = typeof countryData === 'object' ? countryData.universities : '';
    
    // Load the actual SVG flag from file
    const countryMap = loadCountryFlagSVG(country);
    
    // OLD CODE REMOVED - now using SVG files from svg folder
    const countryMaps_DEPRECATED: { [key: string]: string } = {
      'Singapore': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="60" fill="#e74c3c" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="12" font-weight="bold">SG</text></svg>`,
      'Ireland': `<svg viewBox="0 0 100 60" class="country-map"><rect width="33" height="60" fill="#009639"/><rect x="33" width="34" height="60" fill="white"/><rect x="67" width="33" height="60" fill="#ff7900"/><text x="50" y="35" text-anchor="middle" fill="black" font-size="10" font-weight="bold">IE</text></svg>`,
      'Netherlands': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="20" fill="#c8102e"/><rect y="20" width="100" height="20" fill="white"/><rect y="40" width="100" height="20" fill="#003da5"/><text x="50" y="35" text-anchor="middle" fill="black" font-size="10" font-weight="bold">NL</text></svg>`,
      'Canada': `<svg viewBox="0 0 100 60" class="country-map"><rect width="25" height="60" fill="#ff0000"/><rect x="25" width="50" height="60" fill="white"/><rect x="75" width="25" height="60" fill="#ff0000"/><text x="50" y="35" text-anchor="middle" fill="red" font-size="10" font-weight="bold">🍁</text></svg>`,
      'Australia': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="60" fill="#012169"/><rect width="50" height="30" fill="#012169"/><text x="70" y="45" text-anchor="middle" fill="white" font-size="10" font-weight="bold">AU</text></svg>`,
      'United Kingdom': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="60" fill="#012169"/><path d="M0,0 L100,60 M100,0 L0,60" stroke="white" stroke-width="6"/><path d="M50,0 L50,60 M0,30 L100,30" stroke="white" stroke-width="10"/><path d="M0,0 L100,60 M100,0 L0,60" stroke="#c8102e" stroke-width="4"/><path d="M50,0 L50,60 M0,30 L100,30" stroke="#c8102e" stroke-width="6"/></svg>`,
      'Germany': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="20" fill="#000000"/><rect y="20" width="100" height="20" fill="#dd0000"/><rect y="40" width="100" height="20" fill="#ffce00"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">DE</text></svg>`,
      'United States': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="60" fill="#b22234"/><rect y="0" width="100" height="5" fill="white"/><rect y="10" width="100" height="5" fill="white"/><rect y="20" width="100" height="5" fill="white"/><rect y="30" width="100" height="5" fill="white"/><rect y="40" width="100" height="5" fill="white"/><rect y="50" width="100" height="5" fill="white"/><rect width="40" height="35" fill="#3c3b6e"/><text x="70" y="45" text-anchor="middle" fill="white" font-size="10" font-weight="bold">US</text></svg>`,
      'India': `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="20" fill="#ff9933"/><rect y="20" width="100" height="20" fill="white"/><rect y="40" width="100" height="20" fill="#138808"/><circle cx="50" cy="30" r="8" fill="none" stroke="#000080" stroke-width="1"/><text x="50" y="35" text-anchor="middle" fill="#000080" font-size="8" font-weight="bold">☸</text></svg>`,
      'United Arab Emirates': `<svg viewBox="0 0 100 60" class="country-map"><rect width="25" height="60" fill="#ce1126"/><rect x="25" width="75" height="20" fill="#009639"/><rect x="25" y="20" width="75" height="20" fill="white"/><rect x="25" y="40" width="75" height="20" fill="#000000"/><text x="60" y="35" text-anchor="middle" fill="red" font-size="10" font-weight="bold">AE</text></svg>`
    };
    
    // const countryMap = countryMaps_DEPRECATED[country] || `<svg viewBox="0 0 100 60" class="country-map"><rect width="100" height="60" fill="#3498db" rx="8"/><text x="50" y="35" text-anchor="middle" fill="white" font-size="10" font-weight="bold">🌍</text></svg>`;
    
    return `
      <div class="country-card">
        <div class="country-rank">#${index + 1}</div>
        <div class="country-flag">${countryMap}</div>
        <div class="country-name">${country}</div>
        <div class="country-score">${matchScore}% Match</div>
        ${universities ? `<div class="universities-section"><span class="universities-label">Universities:</span><span class="universities-list">${universities}</span></div>` : ''}
      </div>
    `;
  };

  // Helper to generate recommendation sections
  const generateRecommendationSection = (title: string, items: string[], icon: string) => `
    <div class="recommendation-section">
      <div class="recommendation-header">
        <span class="recommendation-icon">${icon}</span>
        <h4>${title}</h4>
      </div>
      <div class="recommendation-content">
        ${items.map((item, index) => `
          <div class="recommendation-item">
            <span class="item-number">${index + 1}</span>
            <span class="item-text">${item}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>D-Vivid Consultant - Study Abroad Assessment Report</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap');

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Inter', 'Poppins', sans-serif;
                line-height: 1.6;
                color: #1e293b;
                background: #ffffff;
                margin: 0;
                padding: 0;
                font-size: 11pt;
                font-weight: 500;
            }
            
            h1 {
                font-size: 20pt;
                font-weight: 900;
                font-family: 'Poppins', sans-serif;
                line-height: 1.2;
            }
            
            h2 {
                font-size: 16pt;
                font-weight: 800;
                font-family: 'Poppins', sans-serif;
                line-height: 1.3;
            }
            
            h3 {
                font-size: 14pt;
                font-weight: 700;
                font-family: 'Poppins', sans-serif;
                line-height: 1.4;
            }
            
            h4 {
                font-size: 12pt;
                font-weight: 700;
                font-family: 'Poppins', sans-serif;
                line-height: 1.4;
            }
            
            .note-text {
                font-size: 9pt;
                color: #64748b;
                font-weight: 400;
            }
            
            .page {
                width: 210mm;
                min-height: 297mm;
                margin: 0 auto;
                background: #ffffff;
                position: relative;
                padding: 0;
            }
            
            .page::after {
                content: '';
                position: absolute;
                bottom: 20mm;
                right: 20mm;
                width: 80px;
                height: 80px;
                background-image: url('${logoDataURI}');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
                opacity: 0.08;
                z-index: 0;
                pointer-events: none;
            }
            
            .section-divider {
                width: 100%;
                height: 1px;
                background: linear-gradient(90deg, transparent, #0066CC 20%, #F1C40F 50%, #0066CC 80%, transparent);
                margin: 30px 0;
                position: relative;
            }
            
            .section-divider::before {
                content: '';
                position: absolute;
                left: 50%;
                top: -3px;
                transform: translateX(-50%);
                width: 8px;
                height: 8px;
                background: #0066CC;
                border-radius: 50%;
            }
            
            .section-divider::after {
                content: '';
                position: absolute;
                left: 50%;
                top: -3px;
                transform: translateX(-50%);
                width: 8px;
                height: 8px;
                background: #F1C40F;
                border-radius: 50%;
                margin-left: 12px;
            }
            
            .page-break {
                page-break-before: always;
                break-before: page;
            }
            
            .page:first-child {
                page-break-before: auto;
                break-before: auto;
            }
            
            .page:empty {
                display: none;
            }
            
            @media print {
                .page:empty {
                    display: none !important;
                }
            }
            
            .country-page {
                min-height: calc(297mm - 160px);
                padding: 20px 25px 100px 25px;
                background: linear-gradient(135deg, #ffffff 0%, #f8fafb 100%);
            }
            
            .header {
                background: linear-gradient(135deg, #0066CC 0%, #0066CC 25%, #F1C40F 75%, #2ECC71 100%);
                color: white;
                padding: 15px 25px;
                text-align: center;
                position: relative;
                overflow: hidden;
                height: 100px;
                min-height: 100px;
                border-radius: 16px 16px 0 0;
                box-shadow: 0 4px 15px rgba(0, 102, 204, 0.3);
            }
            
            .header::before {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 200%;
                height: 100%;
                background: linear-gradient(45deg, 
                    transparent 30%, 
                    rgba(255,255,255,0.1) 50%, 
                    transparent 70%);
                animation: headerShine 4s ease-in-out infinite;
            }
            
            @keyframes headerShine {
                0% { left: -100%; }
                50% { left: 100%; }
                100% { left: -100%; }
            }
            
            .header-content {
                display: flex;
                align-items: center;
                justify-content: space-between;
                height: 100%;
            }
            
            .logo-section {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            
            .logo {
                width: 60px;
                height: 60px;
                background: linear-gradient(135deg, #ffffff, #f8f9fa);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 6px 20px rgba(0,0,0,0.4);
                border: 3px solid rgba(255,255,255,0.3);
                position: relative;
                z-index: 2;
            }
            
            .logo img {
                max-width: 80%;
                max-height: 80%;
            }
            
            .company-info h1 {
                font-family: 'Montserrat', sans-serif;
                font-size: 1.7em;
                font-weight: 900;
                margin: 0;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.4);
                line-height: 1.1;
                position: relative;
                z-index: 2;
                letter-spacing: 0.5px;
            }
            
            .company-info p {
                font-size: 0.85em;
                opacity: 0.95;
                margin: 3px 0 0 0;
                font-weight: 600;
                line-height: 1.2;
                position: relative;
                z-index: 2;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.3);
            }
            
            .report-title {
                text-align: center;
                flex: 1;
            }
            
            .report-title h2 {
                font-size: 1.3em;
                font-weight: 800;
                margin: 0;
                line-height: 1.2;
                padding: 0 10px;
                text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
                position: relative;
                z-index: 2;
                letter-spacing: 0.5px;
            }
            
            .report-title p {
                font-size: 0.8em;
                opacity: 0.95;
                margin: 3px 0 0 0;
                padding: 0 10px;
                position: relative;
                z-index: 2;
                font-weight: 500;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
            }
            
            .footer {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #0066CC 0%, #0066CC 50%, #2ECC71 100%);
                color: white;
                padding: 8px 20px;
                text-align: center;
                font-size: 9pt;
                height: 50px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-radius: 0 0 16px 16px;
                z-index: 10;
            }
            
            .disclaimer {
                position: absolute;
                bottom: 50px;
                left: 20px;
                right: 20px;
                background: linear-gradient(135deg, #fff9e6, #fff3cd);
                border: 2px solid #ffeaa7;
                border-left: 5px solid #fdcb6e;
                padding: 15px 25px;
                font-size: 0.9em;
                line-height: 1.5;
                color: #6c5ce7;
                font-weight: 600;
                text-align: center;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            
            .footer-logo {
                width: 20px;
                height: 20px;
                background: white;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-right: 8px;
            }
            
            .footer-logo img {
                max-width: 70%;
                max-height: 70%;
            }
            
            .content {
                padding: 20px 25px;
                max-height: calc(297mm - 160px);
                display: flex;
                flex-direction: column;
                gap: 15px;
                background: linear-gradient(135deg, #ffffff 0%, #f8fafb 100%);
                padding-bottom: 60px;
                overflow: hidden;
            }
            
            .student-info {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-bottom: 15px;
                padding: 15px;
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                border-radius: 12px;
                border: 2px solid #e9ecef;
                box-shadow: 0 4px 12px rgba(0,0,0,0.08);
            }
            
            .info-item {
                background: linear-gradient(135deg, #ffffff, #f0f9ff);
                padding: 20px;
                border-radius: 12px;
                border: 2px solid #e0f2fe;
                border-left: 5px solid #0066CC;
                box-shadow: 0 4px 12px rgba(0, 59, 140, 0.1);
                transition: transform 0.2s ease;
            }
            
            .info-item:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(0, 59, 140, 0.15);
            }
            
            .info-label {
                font-weight: 800;
                color: #0066CC;
                margin-bottom: 10px;
                font-size: 0.85em;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                display: flex;
                align-items: center;
            }
            
            .info-label::before {
                content: '▸';
                color: #2ECC71;
                margin-right: 10px;
                font-size: 1.4em;
                font-weight: bold;
            }
            
            .info-value {
                font-size: 1.3em;
                font-weight: 700;
                color: #1e40af;
                word-break: break-word;
                line-height: 1.4;
            }
            
            .overall-score {
                text-align: center;
                margin: 15px 0;
                padding: 20px 20px;
                background: linear-gradient(135deg, #003B8C 0%, #1e40af 25%, #5BE49B 75%, #22c55e 100%);
                color: white;
                border-radius: 20px;
                position: relative;
                overflow: hidden;
                box-shadow: 0 10px 30px rgba(0, 59, 140, 0.4);
                border: 3px solid rgba(255,255,255,0.2);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }
            
            .circular-progress-container {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 12px;
                position: relative;
                z-index: 2;
            }
            
            .circular-progress-chart {
                display: block;
                margin: 0 auto;
                filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1));
            }
            
            .readiness-level-badge {
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.2));
                backdrop-filter: blur(10px);
                padding: 8px 20px;
                border-radius: 20px;
                border: 2px solid rgba(255, 255, 255, 0.4);
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            
            .readiness-level-text {
                font-size: 0.95em;
                font-weight: 800;
                color: white;
                text-transform: uppercase;
                letter-spacing: 1.2px;
                text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
            }
            
            .scores-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin: 15px 0;
                padding: 15px;
                background: linear-gradient(135deg, #f8f9fa, #ffffff);
                border-radius: 16px;
                border: 2px solid #e9ecef;
            }
            
            .score-card {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 15px;
                border-radius: 12px;
                border: 2px solid #e9ecef;
                text-align: center;
                position: relative;
                overflow: hidden;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                transition: all 0.3s ease;
            }
            
            .score-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
            }
            
            .score-card:hover {
                transform: translateY(-3px);
                box-shadow: 0 6px 20px rgba(0,0,0,0.15);
            }
            
            .score-card h4 {
                font-size: 1.1em;
                color: #0066CC;
                font-weight: 700;
                margin-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .score-value {
                font-size: 2.2em;
                font-weight: 900;
                color: #0066CC;
                margin-bottom: 8px;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
                white-space: nowrap;
                display: inline-block;
                line-height: 1;
                position: relative;
            }
            
            .score-number {
                display: inline-block;
            }
            
            .percent-symbol {
                display: inline-block;
                font-size: 0.7em;
                vertical-align: top;
                margin-left: 1px;
            }
            
            .score-value::before,
            .score-value::after {
                content: none !important;
                display: none !important;
            }
            
            .score-card {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            .score-bar {
                height: 12px;
                background: linear-gradient(90deg, #e9ecef, #f8f9fa);
                border-radius: 6px;
                overflow: hidden;
                margin-bottom: 8px;
                position: relative;
            }
            
            .score-bar::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(45deg, 
                    rgba(255,255,255,0.2) 25%, 
                    transparent 25%, 
                    transparent 50%, 
                    rgba(255,255,255,0.2) 50%, 
                    rgba(255,255,255,0.2) 75%, 
                    transparent 75%);
                background-size: 8px 8px;
            }
            
            .score-fill {
                height: 100%;
                border-radius: 6px;
                transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            
            .score-fill::after {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                animation: shine 2s infinite;
            }
            
            @keyframes shine {
                0% { left: -100%; }
                100% { left: 100%; }
            }
            
            .score-fill.excellent { background: linear-gradient(90deg, #22C55E, #16A34A); }
            .score-fill.good { background: linear-gradient(90deg, #3B82F6, #2563EB); }
            .score-fill.average { background: linear-gradient(90deg, #F59E0B, #D97706); }
            .score-fill.weak { background: linear-gradient(90deg, #EF4444, #DC2626); }
            
            .analysis-section {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 20px;
                border-radius: 16px;
                border: 3px solid #e9ecef;
                margin: 15px 0;
                box-shadow: 0 6px 20px rgba(0,0,0,0.12);
                position: relative;
                overflow: hidden;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            .analysis-section.strengths {
                background: linear-gradient(135deg, #f0fdf4, #dcfce7);
                border-left: 6px solid #2ECC71;
                border-right: 6px solid #2ECC71;
            }
            
            .analysis-section.gaps {
                background: linear-gradient(135deg, #fffbeb, #fef3c7);
                border-left: 6px solid #f59e0b;
                border-right: 6px solid #f59e0b;
            }
            
            .analysis-section.recommendations {
                background: linear-gradient(135deg, #eff6ff, #dbeafe);
                border-left: 6px solid #3b82f6;
                border-right: 6px solid #3b82f6;
            }
            
            .analysis-section::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 5px;
            }
            
            .analysis-section.strengths::before {
                background: linear-gradient(90deg, #2ECC71, #2ECC71, #2ECC71);
            }
            
            .analysis-section.gaps::before {
                background: linear-gradient(90deg, #f59e0b, #d97706, #f59e0b);
            }
            
            .analysis-section.recommendations::before {
                background: linear-gradient(90deg, #3b82f6, #2563eb, #3b82f6);
            }
            
            .analysis-section h4 {
                font-size: 1.5em;
                margin-bottom: 18px;
                font-weight: 900;
                display: flex;
                align-items: center;
                text-transform: uppercase;
                letter-spacing: 1px;
                padding: 12px 18px;
                border-radius: 8px;
                margin-left: -25px;
                margin-right: -25px;
                margin-top: -25px;
            }
            
            .analysis-section.strengths h4 {
                background: linear-gradient(135deg, #2ECC71, #2ECC71);
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
            }
            
            .analysis-section.gaps h4 {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
            }
            
            .analysis-section.recommendations h4 {
                background: linear-gradient(135deg, #3b82f6, #2563eb);
                color: white;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.2);
            }
            
            .analysis-section h4::after {
                display: none;
            }
ییر<｜tool▁call▁begin｜>
read_file
            
            .analysis-section p {
                line-height: 1.8;
                color: #495057;
                font-size: 1.1em;
                text-align: justify;
                text-indent: 20px;
                margin-bottom: 0;
            }
            
            .bullet-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            
            .bullet-item {
                position: relative;
                padding-left: 30px;
                margin-bottom: 12px;
                line-height: 1.6;
                color: #1e293b;
                font-size: 11pt;
                font-weight: 500;
            }
            
            .bullet-item::before {
                content: '';
                position: absolute;
                left: 0;
                top: 2px;
                width: 18px;
                height: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .strengths .bullet-item {
                background: rgba(46, 204, 113, 0.05);
                padding: 12px 15px;
                padding-left: 35px;
                border-radius: 8px;
                margin-bottom: 10px;
                border-left: 4px solid #2ECC71;
            }
            
            .strengths .bullet-item::before {
                content: '';
                width: 18px;
                height: 18px;
                background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMjAgNkw5IDE3TDQgMTIiIHN0cm9rZT0iIzJFRUM3MSIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
            }
            
            .gaps .bullet-item {
                background: rgba(241, 196, 15, 0.05);
                padding: 12px 15px;
                padding-left: 35px;
                border-radius: 8px;
                margin-bottom: 10px;
                border-left: 4px solid #F1C40F;
            }
            
            .gaps .bullet-item::before {
                content: '';
                width: 18px;
                height: 18px;
                background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIgOVYxM00xMiAxN0gxMi4wMU0yMSAxMkMyMSAxNi45NzA2IDE2Ljk3MDYgMjEgMTIgMjJDNy4wMjk0NCAyMSAzIDE2Ljk3MDYgMyAxMkMzIDcuMDI5NDQgNy4wMjk0NCAzIDEyIDNDMTYuOTcwNiAzIDIxIDcuMDI5NDQgMjEgMTJaIiBzdHJva2U9IiNGMUMyMEYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
            }
            
            .recommendations .bullet-item {
                background: rgba(0, 102, 204, 0.05);
                padding: 12px 15px;
                padding-left: 35px;
                border-radius: 8px;
                margin-bottom: 10px;
                border-left: 4px solid #0066CC;
            }
            
            .recommendations .bullet-item::before {
                content: '';
                width: 18px;
                height: 18px;
                background-image: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNSAxMkgxOU0xOSAxMkwxMiA1TTE5IDEyTDEyIDE5IiBzdHJva2U9IiMwMDY2Q0MiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+');
                background-size: contain;
                background-repeat: no-repeat;
                background-position: center;
            }
            
            .country-fit {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 20px;
                margin: 25px 0 35px 0;
                padding: 20px;
                background: linear-gradient(135deg, #f8f9fa, #ffffff);
                border-radius: 16px;
                border: 2px solid #e9ecef;
            }
            
            .country-card {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 20px;
                border-radius: 12px;
                text-align: center;
                border: 2px solid #e9ecef;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                position: relative;
                overflow: hidden;
                transition: transform 0.3s ease;
                page-break-inside: avoid;
                break-inside: avoid;
                margin-bottom: 15px;
            }
            
            .country-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
            }
            
            .country-card:hover {
                transform: translateY(-2px);
            }
            
            .country-rank {
                background: linear-gradient(45deg, #003B8C, #5BE49B);
                color: white;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 8px auto;
                font-weight: 800;
                font-size: 1.1em;
            }
            
            .country-flag {
                margin-bottom: 10px;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .country-map {
                width: 90px;
                height: 60px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0, 102, 204, 0.25);
                border: 2px solid rgba(0, 102, 204, 0.2);
                display: block;
                margin: 0 auto;
                object-fit: contain;
            }
            
            .country-name {
                font-size: 1.2em;
                font-weight: 700;
                color: #0066CC;
                margin-bottom: 5px;
            }
            
            .country-score {
                background: linear-gradient(45deg, #5BE49B, #4ade80);
                color: white;
                padding: 4px 8px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 1.0em;
            }
            
            .universities-section {
                margin-top: 12px;
                padding: 12px;
                background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
                border-radius: 8px;
                border-left: 4px solid #003B8C;
                text-align: left;
            }
            
            .universities-label {
                display: block;
                font-weight: 800;
                color: #0066CC;
                font-size: 0.85em;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                margin-bottom: 6px;
            }
            
            .universities-list {
                display: block;
                color: #1e40af;
                font-size: 0.8em;
                line-height: 1.6;
                font-weight: 600;
            }
            
            .recommended-destinations-heading {
                grid-column: 1/-1;
                text-align: center;
                background: linear-gradient(135deg, #003B8C 0%, #1e40af 25%, #5BE49B 75%, #22c55e 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 15px;
                font-size: 1.8em;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 2px;
                position: relative;
                padding-bottom: 15px;
                text-shadow: none;
                page-break-after: avoid;
                break-after: avoid;
            }
            
            .recommended-destinations-heading::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 150px;
                height: 4px;
                background: linear-gradient(90deg, #003B8C, #5BE49B, #003B8C);
                border-radius: 2px;
            }
            
            .recommended-destinations-divider {
                grid-column: 1/-1;
                width: 150px;
                height: 3px;
                background: linear-gradient(90deg, #003B8C, #5BE49B, #003B8C);
                margin: 0 auto 25px auto;
                border-radius: 2px;
            }
            
            .readiness-section-combined {
                display: flex;
                flex-direction: column;
                gap: 15px;
                margin-bottom: 20px;
                page-break-inside: avoid;
                break-inside: avoid;
                min-height: auto;
            }
            
            .scores-section-on-page2 {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 18px;
                border-radius: 16px;
                border: 3px solid #003B8C;
                box-shadow: 0 8px 25px rgba(0, 59, 140, 0.15);
                position: relative;
                overflow: hidden;
                page-break-inside: avoid;
                break-inside: avoid;
                flex-shrink: 0;
            }
            
            .scores-section-on-page2::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 5px;
                background: linear-gradient(90deg, #003B8C, #5BE49B, #003B8C);
            }
            
            .scores-grid-page2 .score-card {
                padding: 12px;
                border-radius: 10px;
            }
            
            .scores-grid-page2 .score-card h4 {
                font-size: 0.9em;
                margin-bottom: 8px;
                line-height: 1.2;
            }
            
            .scores-grid-page2 .score-value {
                font-size: 1.8em;
                margin-bottom: 6px;
            }
            
            .scores-grid-page2 .score-bar {
                height: 10px;
                margin-bottom: 6px;
            }
            
            .scores-grid-page2 {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-top: 12px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            .charts-section-full {
                margin: 0;
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 12px 18px;
                border-radius: 16px;
                border: 3px solid #003B8C;
                box-shadow: 0 8px 25px rgba(0, 59, 140, 0.15);
                position: relative;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                page-break-inside: avoid;
                break-inside: avoid;
                flex-shrink: 0;
            }
            
            .charts-section-full::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 5px;
                background: linear-gradient(90deg, #003B8C, #5BE49B, #003B8C);
            }
            
            .radar-chart-svg-full {
                max-width: 100%;
                height: auto;
                display: block;
                margin: 0 auto;
            }
            
            .radar-chart-full-page {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                width: 100%;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            .radar-legend-enhanced {
                width: 100%;
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
                margin-top: 25px;
                padding: 15px;
                background: linear-gradient(135deg, #f8fafb, #ffffff);
                border-radius: 12px;
                border: 2px solid #e9ecef;
            }
            
            .radar-legend-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                background: white;
                border-radius: 8px;
                border-left: 4px solid transparent;
                box-shadow: 0 2px 6px rgba(0,0,0,0.05);
                transition: transform 0.2s ease;
            }
            
            .radar-legend-item:hover {
                transform: translateX(3px);
            }
            
            .radar-legend-icon {
                font-size: 1.4em;
                line-height: 1;
            }
            
            .radar-legend-color {
                width: 20px;
                height: 20px;
                border-radius: 4px;
                flex-shrink: 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.15);
            }
            
            .radar-legend-label {
                flex: 1;
                font-size: 0.9em;
                font-weight: 600;
                color: #0066CC;
            }
            
            .radar-legend-score {
                font-size: 1em;
                font-weight: 800;
                color: #0066CC;
                min-width: 45px;
                text-align: right;
            }
            
            .charts-section {
                margin: 30px 0;
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 30px;
                border-radius: 16px;
                border: 3px solid #003B8C;
                box-shadow: 0 8px 25px rgba(0, 59, 140, 0.15);
                position: relative;
                overflow: hidden;
            }
            
            .charts-section::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 5px;
                background: linear-gradient(90deg, #003B8C, #5BE49B, #003B8C);
            }
            
            .charts-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 20px;
                margin-bottom: 20px;
            }
            
            .chart-container {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 20px;
                border-radius: 12px;
                border: 2px solid #e9ecef;
                box-shadow: 0 4px 15px rgba(0,0,0,0.12);
                position: relative;
                overflow: hidden;
            }
            
            .chart-container::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
            }
            
            .chart-container.full-width {
                grid-column: 1 / -1;
                margin-bottom: 30px;
                orphans: 2;
                widows: 2;
            }
            
            .country-cards-grid-container {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 15px;
                margin-top: 15px;
            }
            
            @media print {
                .country-cards-grid-container {
                    orphans: 2;
                    widows: 2;
                }
                
                .country-card-grid {
                    orphans: 2;
                    widows: 2;
                    page-break-inside: avoid;
                    break-inside: avoid;
                }
                
                .country-fit {
                    orphans: 2;
                    widows: 2;
                }
            }
            
            @media (max-width: 1200px) {
                .country-cards-grid-container {
                    grid-template-columns: repeat(2, 1fr);
                }
            }
            
            @media (max-width: 800px) {
                .country-cards-grid-container {
                    grid-template-columns: 1fr;
                }
            }
            
            .country-card-grid {
                background: linear-gradient(135deg, #ffffff, #f8fafc);
                border-radius: 16px;
                border: 2px solid #e9ecef;
                box-shadow: 0 6px 20px rgba(0, 102, 204, 0.15);
                padding: 18px;
                position: relative;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                display: flex;
                flex-direction: column;
                min-height: auto;
                orphans: 2;
                widows: 2;
                margin-bottom: 0;
            }
            
            .country-card-grid::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
                border-radius: 16px 16px 0 0;
            }
            
            .country-rank-badge {
                position: absolute;
                top: 15px;
                right: 15px;
                padding: 6px 12px;
                border-radius: 20px;
                border: 2px solid;
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 0.75em;
                font-weight: 700;
                font-family: 'Poppins', sans-serif;
                z-index: 10;
            }
            
            .rank-icon {
                font-size: 1.2em;
                line-height: 1;
            }
            .rank-medal-img {
                width: 22px;
                height: 22px;
                display: inline-block;
                object-fit: contain;
                border-radius: 50%;
                box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            }
            
            .rank-label { display: none; }
            .rank-number {
                font-size: 0.85em;
                color: #1e293b;
                font-weight: 800;
            }
            
            .country-card-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
                padding-bottom: 12px;
                border-bottom: 2px solid #e9ecef;
            }
            
            .country-flag-section {
                flex-shrink: 0;
            }
            
            .country-flag-section .country-map {
                width: 100px;
                height: 70px;
                border-radius: 8px;
                box-shadow: 0 3px 10px rgba(0,0,0,0.15);
                border: 2px solid rgba(0, 102, 204, 0.2);
            }
            
            .country-title-section {
                flex: 1;
                min-width: 0;
            }
            
            .country-card-name {
                font-size: 1.4em;
                font-weight: 900;
                color: #0066CC;
                margin: 0 0 6px 0;
                font-family: 'Poppins', sans-serif;
                line-height: 1.2;
            }
            
            .country-match-info {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 0.95em;
                font-weight: 600;
                font-family: 'Inter', sans-serif;
                padding: 6px 10px;
                border-radius: 999px;
                border: 1px solid #e2e8f0;
                background: #f8fafc;
            }
            
            .match-percentage {
                color: #0066CC;
                font-weight: 800;
            }
            
            .match-divider {
                color: #cbd5e1;
                font-weight: 300;
            }
            
            .match-strength {
                color: #64748b;
                font-weight: 600;
            }
            
            .country-progress-container {
                margin: 12px 0;
            }
            
            .country-progress-bar {
                width: 100%;
                height: 10px;
                background: linear-gradient(90deg, #e9ecef, #f1f5f9);
                border-radius: 10px;
                overflow: hidden;
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .country-progress-fill {
                height: 100%;
                border-radius: 10px;
                transition: width 0.3s ease;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }
            
            .country-metrics-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
                margin: 12px 0;
            }
            
            .country-metric-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                border-radius: 10px;
                border: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
                position: relative;
                overflow: hidden;
            }
            
            .country-metric-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 3px;
                opacity: 0.8;
            }
            
            .country-metric-item[data-metric="tuition"] {
                background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            }
            
            .country-metric-item[data-metric="tuition"]::before {
                background: linear-gradient(90deg, #f59e0b, #d97706);
            }
            
            .country-metric-item[data-metric="community"] {
                background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
            }
            
            .country-metric-item[data-metric="community"]::before {
                background: linear-gradient(90deg, #3b82f6, #2563eb);
            }
            
            .country-metric-item[data-metric="support"] {
                background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
            }
            
            .country-metric-item[data-metric="support"]::before {
                background: linear-gradient(90deg, #10b981, #059669);
            }
            
            .country-metric-item[data-metric="language"] {
                background: linear-gradient(135deg, #e9d5ff 0%, #ddd6fe 100%);
            }
            
            .country-metric-item[data-metric="language"]::before {
                background: linear-gradient(90deg, #8b5cf6, #7c3aed);
            }
            
            .metric-icon {
                font-size: 1.8em;
                line-height: 1;
                flex-shrink: 0;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            }
            
            .metric-icon-wrapper {
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 10px;
                background: rgba(255, 255, 255, 0.6);
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            }
            
            .metric-content {
                display: flex;
                flex-direction: column;
                gap: 2px;
                flex: 1;
                min-width: 0;
            }
            
            .metric-label {
                font-size: 0.7em;
                color: #475569;
                font-weight: 700;
                font-family: 'Inter', sans-serif;
                text-transform: uppercase;
                letter-spacing: 0.8px;
            }
            
            .metric-value {
                font-size: 0.95em;
                color: #1e293b;
                font-weight: 800;
                font-family: 'Inter', sans-serif;
            }
            .value-chip {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 999px;
                background: rgba(0,102,204,0.08);
                border: 1px solid rgba(0,102,204,0.18);
            }
            
            .country-fit-summary {
                margin-top: 12px;
                padding: 12px;
                background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
                border-radius: 10px;
                border-left: 4px solid #0066CC;
                display: flex;
                gap: 10px;
            }
            
            .fit-summary-icon {
                font-size: 1.5em;
                line-height: 1;
                flex-shrink: 0;
            }
            
            .fit-summary-content {
                flex: 1;
                min-width: 0;
            }
            
            .fit-summary-label {
                font-size: 0.85em;
                font-weight: 700;
                color: #0066CC;
                font-family: 'Poppins', sans-serif;
                display: block;
                margin-bottom: 6px;
            }
            
            .fit-summary-text {
                font-size: 0.85em;
                color: #1e293b;
                font-weight: 500;
                font-family: 'Inter', sans-serif;
                line-height: 1.4;
                margin: 0;
                white-space: normal;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            
            .country-challenges-note {
                margin-top: 10px;
                padding: 10px;
                background: linear-gradient(135deg, #fef2f2, #fee2e2);
                border-radius: 8px;
                border-left: 4px solid #ef4444;
                display: flex;
                gap: 8px;
                align-items: flex-start;
            }
            
            .challenges-icon {
                font-size: 1.2em;
                line-height: 1;
                flex-shrink: 0;
            }
            
            .challenges-text {
                font-size: 0.8em;
                color: #991b1b;
                font-weight: 500;
                font-family: 'Inter', sans-serif;
                line-height: 1.3;
                font-style: italic;
                white-space: normal;
                word-break: break-word;
                overflow-wrap: anywhere;
            }
            
            .chart-container h4 {
                color: #0066CC;
                font-size: 1.3em;
                font-weight: 800;
                margin-bottom: 20px;
                text-align: center;
                text-transform: uppercase;
                letter-spacing: 1px;
                position: relative;
                padding-bottom: 10px;
                page-break-after: avoid;
                break-after: avoid;
            }
            
            .chart-container h4::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 50px;
                height: 2px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
            }
            
            .radar-chart {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .radar-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                background: linear-gradient(135deg, #ffffff, #f8f9fa);
                border-radius: 8px;
                border-left: 5px solid #5BE49B;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                transition: transform 0.2s ease;
            }
            
            .radar-item:hover {
                transform: translateX(5px);
            }
            
            .radar-label {
                font-weight: 600;
                color: #333;
                font-size: 0.9em;
            }
            
            .radar-score {
                font-weight: 700;
                color: #0066CC;
                font-size: 1.1em;
            }
            
            .trend-chart {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            
            .trend-bar {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .trend-label {
                width: 120px;
                font-size: 0.9em;
                font-weight: 600;
                color: #555;
            }
            
            .trend-progress {
                flex: 1;
                height: 24px;
                background: linear-gradient(90deg, #e9ecef, #f8f9fa);
                border-radius: 12px;
                overflow: hidden;
                position: relative;
                border: 1px solid #dee2e6;
            }
            
            .trend-progress::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: repeating-linear-gradient(
                    45deg,
                    transparent,
                    transparent 4px,
                    rgba(255,255,255,0.3) 4px,
                    rgba(255,255,255,0.3) 8px
                );
                z-index: 1;
            }
            
            .trend-fill {
                height: 100%;
                border-radius: 12px;
                background: linear-gradient(135deg, #003B8C, #1e40af, #5BE49B);
                transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                z-index: 2;
            }
            
            .trend-fill::after {
                content: '';
                position: absolute;
                top: 0;
                left: -100%;
                width: 100%;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
                animation: progressShine 2.5s infinite;
                z-index: 3;
            }
            
            @keyframes progressShine {
                0% { left: -100%; }
                100% { left: 100%; }
            }
            
            .trend-value {
                font-weight: 700;
                color: #0066CC;
                font-size: 0.9em;
                min-width: 40px;
                text-align: right;
            }
            
            .country-matrix {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
                page-break-inside: avoid;
                break-inside: avoid;
            }
            
            .country-matrix-item {
                background: linear-gradient(135deg, #ffffff, #f8fafb);
                padding: 20px;
                border-radius: 12px;
                border: 2px solid #e9ecef;
                text-align: center;
                position: relative;
                overflow: hidden;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                transition: all 0.3s ease;
                page-break-inside: avoid;
                break-inside: avoid;
                margin-bottom: 20px;
            }
            
            .country-matrix-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 5px;
                background: linear-gradient(90deg, #0066CC, #2ECC71);
            }
            
            .country-matrix-item:hover {
                transform: translateY(-3px);
                box-shadow: 0 6px 20px rgba(0,0,0,0.15);
            }
            
            .country-matrix-rank {
                background: linear-gradient(45deg, #003B8C, #5BE49B);
                color: white;
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 10px auto;
                font-weight: 800;
                font-size: 1.0em;
            }
            
            .country-matrix-flag {
                margin: 12px auto;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .country-matrix-flag .country-map {
                width: 110px;
                height: 70px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0, 102, 204, 0.25);
                border: 2px solid rgba(0, 102, 204, 0.2);
                display: block;
                margin: 0 auto;
                object-fit: cover;
            }
            
            .country-matrix-name {
                font-size: 1.1em;
                font-weight: 700;
                color: #0066CC;
                margin-bottom: 8px;
            }
            
            .country-matrix-score {
                background: linear-gradient(45deg, #5BE49B, #4ade80);
                color: white;
                padding: 6px 12px;
                border-radius: 20px;
                font-weight: 700;
                font-size: 0.9em;
                display: inline-block;
            }
            
            .country-matrix-desc {
                font-size: 0.8em;
                color: #1e293b;
                margin-top: 12px;
                line-height: 1.5;
                background: linear-gradient(135deg, #f8fafc, #f1f5f9);
                padding: 12px 14px;
                border-radius: 8px;
                border-left: 4px solid #0066CC;
                text-align: left;
            }
            
            .country-bullet-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            
            .country-bullet-item {
                position: relative;
                padding-left: 20px;
                margin-bottom: 6px;
                line-height: 1.4;
                color: #1e293b;
                font-size: 0.85em;
                font-weight: 500;
                font-family: 'Inter', 'Poppins', sans-serif;
                max-width: 100%;
                word-wrap: break-word;
            }
            
            .country-bullet-item:last-child {
                margin-bottom: 0;
            }
            
            .country-bullet-item::before {
                content: '▸';
                position: absolute;
                left: 0;
                top: 2px;
                color: #0066CC;
                font-size: 1.0em;
                font-weight: 700;
                line-height: 1.4;
            }
            
            .country-matrix-text {
                color: #1e293b;
                font-size: 0.9em;
                font-weight: 500;
                line-height: 1.6;
                font-family: 'Inter', 'Poppins', sans-serif;
            }
            
            .country-matrix-text p {
                margin: 0 0 8px 0;
                text-align: justify;
            }
            
            .country-matrix-text p:last-child {
                margin-bottom: 0;
            }
            
            @media print {
                body { 
                    -webkit-print-color-adjust: exact; 
                    print-color-adjust: exact;
                    margin: 0;
                    padding: 0;
                }
                .page { 
                    box-shadow: none; 
                    border: none;
                    margin: 0;
                    page-break-after: always;
                }
                .page:last-child {
                    page-break-after: auto;
                }
                .page-break {
                    page-break-before: always;
                    break-before: page;
                }
                .header, .footer, .disclaimer { 
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .header {
                    background: linear-gradient(135deg, #0066CC 0%, #0066CC 25%, #F1C40F 75%, #2ECC71 100%) !important;
                }
                .footer {
                    background: linear-gradient(135deg, #0066CC 0%, #0066CC 50%, #2ECC71 100%) !important;
                }
                .disclaimer {
                    background: linear-gradient(135deg, #fff9e6, #fff3cd) !important;
                    border-color: #fdcb6e !important;
                }
                * {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
            }
        </style>
    </head>
    <body>
        <div class="page">
            <div class="header">
                <div class="header-content">
                    <div class="logo-section">
                        <div class="logo">
                            <img src="${logoDataURI}" alt="D-Vivid Logo"/>
                        </div>
                        <div class="company-info">
                            <h1>D-Vivid Consultant</h1>
                            <p>Your Gateway to Global Education</p>
                        </div>
                    </div>
                    <div class="report-title">
                        <h2>Study Abroad Assessment Report</h2>
                        <p>Comprehensive Readiness Index (CRI)</p>
                    </div>
                </div>
            </div>
            
            <div class="content">
                <div class="student-info">
                    <div class="info-item">
                        <div class="info-label">Student Email</div>
                        <div class="info-value">${studentEmail}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Phone Number</div>
                        <div class="info-value">${studentPhone}</div>
                    </div>
                </div>
                
                <div class="overall-score">
                    ${generateCircularProgressChart(overallIndex, readinessLevel)}
                </div>
                
                <!-- READINESS SCORES -->
                <div style="margin: 20px 0;">
                    <h3 style="text-align: center; color: #0066CC; margin: 0 0 15px 0; font-size: 1.3em; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px;">Readiness Scores</h3>
                    <div class="scores-grid">
                        ${generateScoreCard('Financial Planning', scores['Financial Planning'], getFrameworkWeight('Financial Planning'))}
                        ${generateScoreCard('Academic Readiness', scores['Academic Readiness'], getFrameworkWeight('Academic Readiness'))}
                        ${generateScoreCard('Career Alignment', scores['Career Alignment'], getFrameworkWeight('Career Alignment'))}
                        ${generateScoreCard('Personal & Cultural', scores['Personal & Cultural'], getFrameworkWeight('Personal & Cultural'))}
                        ${generateScoreCard('Practical Readiness', scores['Practical Readiness'], getFrameworkWeight('Practical Readiness'))}
                        ${generateScoreCard('Support System', scores['Support System'], getFrameworkWeight('Support System'))}
                    </div>
                </div>

            </div>
            
            <div class="footer">
                <div style="display: flex; align-items: center;">
                    <div class="footer-logo">
                        <img src="${logoDataURI}" alt="D-Vivid Logo"/>
                    </div>
                    <span>D-Vivid Consultant - Your Gateway to Global Education</span>
                </div>
                <div>Report Generated: ${currentDate}</div>
            </div>
        </div>
        
        <!-- Page 2: Country Analysis -->
        ${countryFit.length > 0 ? `
        <div class="page page-break">
            <div class="header">
                <div class="header-content">
                    <div class="logo-section">
                        <div class="logo">
                            <img src="${logoDataURI}" alt="D-Vivid Logo"/>
                        </div>
                        <div class="company-info">
                            <h1>D-Vivid Consultant</h1>
                            <p>Your Gateway to Global Education</p>
                        </div>
                    </div>
                    <div class="report-title">
                        <h2>Country Analysis & Recommendations</h2>
                        <p>Personalized Study Destinations</p>
                    </div>
                </div>
            </div>
            
            <div class="country-page">
                <!-- READINESS RADAR CHART -->
                <div class="charts-section-full" style="margin-bottom: 25px;">
                    <h3 style="text-align: center; color: #0066CC; margin: 0 0 15px 0; font-size: 1.2em; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; position: relative; padding-bottom: 10px;">Readiness Radar Chart</h3>
                    <div style="width: 100px; height: 4px; background: linear-gradient(90deg, #0066CC, #2ECC71); margin: 0 auto 15px auto; border-radius: 2px;"></div>
                    ${generateRadarChart(scores)}
                </div>
                
                <!-- KEY STRENGTHS -->
                <div class="section-divider"></div>
                <div class="analysis-section strengths">
                    <h4>Key Strengths</h4>
                    <ul class="bullet-list">
                        ${formatToBulletPoints(strengths)}
                    </ul>
                </div>
                
                <!-- AREAS FOR DEVELOPMENT -->
                <div class="section-divider"></div>
                <div class="analysis-section gaps">
                    <h4>Areas for Development</h4>
                    <ul class="bullet-list">
                        ${formatToBulletPoints(gaps)}
                    </ul>
                </div>
                
                <!-- STRATEGIC RECOMMENDATIONS -->
                <div class="section-divider"></div>
                <div class="analysis-section recommendations">
                    <h4>Strategic Recommendations</h4>
                    <ul class="bullet-list">
                        ${formatToBulletPoints(recommendations)}
                    </ul>
                </div>
                
                <!-- COUNTRY CARDS GRID -->
                <div class="chart-container full-width" style="margin: 20px 0;">
                    <h4>Recommended Study Destinations</h4>
                    <div class="country-cards-grid-container">
                        ${generateCountryCardsGrid(countryFit)}
                    </div>
                </div>
                
                <!-- RECOMMENDED STUDY DESTINATIONS -->
                <div class="country-fit" style="margin-top: 20px;">
                    <h4 class="recommended-destinations-heading">Recommended Study Destinations</h4>
                    <div class="recommended-destinations-divider"></div>
                    ${countryFit.map((countryData: any, index: number) => generateCountryCard(countryData, index)).join('')}
                </div>
            </div>
            
            <div class="disclaimer">
                <strong>DISCLAIMER:</strong> Results are based on your inputs and benchmark data. The analysis is intended as guidance and should be interpreted as advisory, not definitive or prescriptive. This assessment provides general recommendations and should be used in conjunction with professional counseling for study abroad planning.
            </div>
            
            <div class="footer">
                <div style="display: flex; align-items: center;">
                    <div class="footer-logo">
                        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9InVybCgjZ3JhZGllbnQwX2xpbmVhcl8xXzEpIi8+CjxwYXRoIGQ9Ik0xMiAxNkgxNlYyNEgxMlYxNloiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0yNCAxNkgyOFYyNEgyNFYxNloiIGZpbGw9IndoaXRlIi/+CjxwYXRoIGQ9Ik0xNiAxMkgyNFYxNkgxNlYxMloiIGZpbGw9IndoaXRlIi/+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9ImdyYWRpZW50MF9saW5lYXJfMV8xIiB4MT0iMCIgeTE9IjAiIHgyPSI0MCIgeTI9IjQwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CjxzdG9wIHN0b3AtY29sb3I9IiMwMDNCOEMiLz4KPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNUJFOEI5Ii8+CjwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPC9zdmc+" alt="D-Vivid Logo"/>
                    </div>
                    <span>D-Vivid Consultant - Your Gateway to Global Education</span>
                </div>
                <div>Report Generated: ${currentDate}</div>
            </div>
        </div>
        ` : ''}
    </body>
    </html>
  `;
}