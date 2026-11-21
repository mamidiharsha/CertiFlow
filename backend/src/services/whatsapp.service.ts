import { config } from '../config';

interface WhatsAppSendRequest {
  phone: string;
  message: string;
  pdfUrl?: string;
}

interface WhatsAppSendResponse {
  messageId: string;
  status: string;
}

/**
 * Mock WhatsApp client. Posts to the configured WHATSAPP_API_URL.
 * Handles timeouts (5s). Retries are managed by BullMQ.
 */
export async function sendWhatsAppMessage(params: WhatsAppSendRequest): Promise<WhatsAppSendResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5-second timeout

  try {
    const response = await fetch(config.whatsappApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: params.phone,
        message: params.message,
        pdfUrl: params.pdfUrl,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`WhatsApp API error: ${response.status} ${errorBody}`);
    }

    const data = (await response.json()) as WhatsAppSendResponse;
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('WhatsApp API timeout (5s exceeded)');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
