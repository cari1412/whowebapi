import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Whop отправляет данные в разных форматах, проверим оба варианта
    const payload = req.body;
    const action = payload.action || payload.type;
    const data = payload.data || payload;

    console.log('Received webhook:', { action, payload });

    // Извлекаем user_id из разных возможных мест
    const userId = data.user_id || data.user?.id || data.membership?.user_id;

    if (!userId) {
      console.error('No user_id found in webhook payload');
      return res.status(400).json({ error: 'Missing user_id' });
    }

    switch (action) {
      case 'membership_activated':
      case 'membership.activated':
      case 'membership.went_valid':
        const { error: activateError } = await supabase
          .from('users')
          .update({ 
            subscription_status: 'active',
            subscription_plan: data.plan_id || data.membership?.plan_id || null
          })
          .eq('whop_user_id', userId);

        if (activateError) {
          console.error('Error activating membership:', activateError);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log(`User ${userId} subscription activated`);
        break;

      case 'membership_deactivated':
      case 'membership.deactivated':
      case 'membership.went_invalid':
        const { error: deactivateError } = await supabase
          .from('users')
          .update({ 
            subscription_status: 'inactive',
            subscription_plan: null
          })
          .eq('whop_user_id', userId);

        if (deactivateError) {
          console.error('Error deactivating membership:', deactivateError);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log(`User ${userId} subscription deactivated`);
        break;

      case 'payment_succeeded':
      case 'payment.succeeded':
        const { data: user, error: fetchError } = await supabase
          .from('users')
          .select('credits')
          .eq('whop_user_id', userId)
          .single();

        if (fetchError) {
          console.error('Error fetching user:', fetchError);
          // Не возвращаем ошибку, так как пользователь может еще не существовать
        }

        if (user) {
          const { error: creditError } = await supabase
            .from('users')
            .update({ credits: user.credits + 100 })
            .eq('whop_user_id', userId);

          if (creditError) {
            console.error('Error adding credits:', creditError);
            return res.status(500).json({ error: 'Database error' });
          }

          console.log(`Added 100 credits to user ${userId}`);
        } else {
          console.log(`User ${userId} not found, skipping credit addition`);
        }
        break;

      default:
        console.log(`Unhandled webhook action: ${action}`);
    }

    return res.status(200).json({ success: true, action, userId });
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Internal server error', message: errorMessage });
  }
}