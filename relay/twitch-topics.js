// Suscripciones de EventSub que usa la meta. Puro: lo comparten el relay (Node) y la versión web (navegador).
export const SCOPES = ['bits:read', 'channel:read:subscriptions', 'moderator:read:followers', 'channel:read:redemptions'];
// tipo, versión, scope necesario (null = ninguno), condición
const TOPICS = [
  ['channel.cheer', '1', 'bits:read', (u) => ({ broadcaster_user_id: u })],
  ['channel.subscribe', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.subscription.message', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.subscription.gift', '1', 'channel:read:subscriptions', (u) => ({ broadcaster_user_id: u })],
  ['channel.follow', '2', 'moderator:read:followers', (u) => ({ broadcaster_user_id: u, moderator_user_id: u })],
  ['channel.raid', '1', null, (u) => ({ to_broadcaster_user_id: u })],
  ['channel.channel_points_custom_reward_redemption.add', '1', 'channel:read:redemptions', (u) => ({ broadcaster_user_id: u })], // canjes de puntos del canal
];
export const topicsFor = (scopes) => TOPICS.filter(([, , s]) => !s || scopes.includes(s));
