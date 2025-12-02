// app/routes/api.logs.tsx
import { type ActionFunctionArgs } from 'react-router';
import { promises as fs } from 'fs';
import path from 'path';

export async function action({ request }: ActionFunctionArgs) {
  // Add CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request for CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const logData = await request.json();

    // Add proper error handling for missing fields
    const level = logData?.level || 'UNKNOWN';
    const message = logData?.message || 'No message provided';
    const timestamp = logData?.timestamp || new Date().toISOString();
    const meta = logData?.meta || {};

    // Format timestamp to match your desired format: [YYYY-MM-DD HH:MM:SS]
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const formattedTimestamp = `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}]`;

    // Create single-line log message
    const metaString = Object.keys(meta).length > 0 ? `${JSON.stringify(meta)}` : '';
    const logMessage = `${formattedTimestamp} [${level}] ${message}${metaString}\n`;

    const logDir = path.join(process.cwd(), 'logs');
    const today = new Date().toISOString().split('T')[0];
    const fileName = `${level.toLowerCase()}-${today}.log`;
    const logFilePath = path.join(logDir, fileName);

    await fs.mkdir(logDir, { recursive: true });
    await fs.appendFile(logFilePath, logMessage, 'utf8');

    // ✅ REMOVED: console.log(`✅ Log written to: ${logFilePath}`);

    return Response.json(
      { status: 'success', message: 'Log received', filePath: logFilePath },
      { 
        status: 200,
        headers: corsHeaders,
      }
    );

  } catch (error) {
    console.error('API: Failed to write log.', error);
    return Response.json(
      { status: 'error', message: 'Failed to write log', error: String(error) },
      { 
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}