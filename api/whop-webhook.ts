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

    const { action, data } = req.body;

    console.log('Received webhook:', { action, userId: data?.user_id });

    switch (action) {
      case 'membership.went_valid':
        const { error: validError } = await supabase
          .from('users')
          .update({ 
            subscription_status: 'active',
            subscription_plan: data.plan_id || null
          })
          .eq('whop_user_id', data.user_id);

        if (validError) {
          console.error('Error activating membership:', validError);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log(`User ${data.user_id} subscription activated`);
        break;

      case 'membership.went_invalid':
        const { error: invalidError } = await supabase
          .from('users')
          .update({ 
            subscription_status: 'inactive',
            subscription_plan: null
          })
          .eq('whop_user_id', data.user_id);

        if (invalidError) {
          console.error('Error deactivating membership:', invalidError);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log(`User ${data.user_id} subscription deactivated`);
        break;

      case 'membership.updated':
        const { error: updateError } = await supabase
          .from('users')
          .update({ 
            subscription_plan: data.plan_id || null
          })
          .eq('whop_user_id', data.user_id);

        if (updateError) {
          console.error('Error updating membership:', updateError);
          return res.status(500).json({ error: 'Database error' });
        }

        console.log(`User ${data.user_id} subscription updated`);
        break;

      case 'payment.succeeded':
        const { data: user, error: fetchError } = await supabase
          .from('users')
          .select('credits')
          .eq('whop_user_id', data.user_id)
          .single();

        if (fetchError) {
          console.error('Error fetching user:', fetchError);
          return res.status(500).json({ error: 'Database error' });
        }

        if (user) {
          const { error: creditError } = await supabase
            .from('users')
            .update({ credits: user.credits + 100 })
            .eq('whop_user_id', data.user_id);

          if (creditError) {
            console.error('Error adding credits:', creditError);
            return res.status(500).json({ error: 'Database error' });
          }

          console.log(`Added 100 credits to user ${data.user_id}`);
        }
        break;

      default:
        console.log(`Unhandled webhook action: ${action}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}