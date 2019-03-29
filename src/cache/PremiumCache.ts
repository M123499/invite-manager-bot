import {
	premiumSubscriptionGuilds,
	premiumSubscriptions,
	sequelize
} from '../sequelize';
import { BotType } from '../types';

import { GuildCache } from './GuildCache';

export class PremiumCache extends GuildCache<boolean> {
	protected initOne(guildId: string): boolean {
		return false;
	}

	// This is public on purpose, so we can use it in the IMClient class
	public async _get(guildId: string): Promise<boolean> {
		// Custom bots always have premium
		if (this.client.type === BotType.custom) {
			return true;
		}

		const sub = await premiumSubscriptionGuilds.findOne({
			where: {
				guildId
			},
			include: [
				{
					attributes: [],
					model: premiumSubscriptions,
					where: {
						validUntil: {
							[sequelize.Op.gte]: new Date()
						}
					},
					required: true
				}
			]
		});

		return !!sub;
	}
}
