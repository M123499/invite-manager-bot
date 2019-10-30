import { Member, Message } from 'eris';

import { IMClient } from '../../../client';
import { Command, Context } from '../../../framework/commands/Command';
import { MemberResolver, NumberResolver, StringResolver } from '../../../framework/resolvers';
import { PunishmentType } from '../../../models/PunishmentConfig';
import { CommandGroup, GuildPermission, ModerationCommand } from '../../../types';

export default class extends Command {
	public constructor(client: IMClient) {
		super(client, {
			name: ModerationCommand.softBan,
			aliases: ['soft-ban'],
			args: [
				{
					name: 'user',
					resolver: MemberResolver,
					required: true
				},
				{
					name: 'reason',
					resolver: StringResolver,
					rest: true
				}
			],
			flags: [
				{
					name: 'deleteMessageDays',
					resolver: NumberResolver,
					short: 'd'
				}
			],
			group: CommandGroup.Moderation,
			botPermissions: [GuildPermission.BAN_MEMBERS],
			defaultAdminOnly: true,
			guildOnly: true
		});
	}

	public async action(
		message: Message,
		[targetMember, reason]: [Member, string],
		{ deleteMessageDays }: { deleteMessageDays: number },
		{ guild, me, settings, t }: Context
	): Promise<any> {
		const embed = this.client.mod.createBasicEmbed(targetMember);

		if (this.client.mod.isPunishable(guild, targetMember, message.member, me)) {
			await this.client.mod.informAboutPunishment(targetMember, PunishmentType.softban, settings, { reason });

			const days = deleteMessageDays ? deleteMessageDays : 0;
			try {
				await targetMember.ban(days, reason);
				await targetMember.unban('softban');

				// Make sure member exists in DB
				await this.client.db.saveMembers([
					{
						id: targetMember.user.id,
						name: targetMember.user.username,
						discriminator: targetMember.user.discriminator
					}
				]);

				const punishment = await this.client.repo.punishment.save({
					guildId: guild.id,
					memberId: targetMember.id,
					type: PunishmentType.softban,
					amount: 0,
					args: '',
					reason: reason,
					creatorId: message.author.id
				});

				await this.client.mod.logPunishmentModAction(
					guild,
					targetMember.user,
					punishment.type,
					punishment.amount,
					[{ name: 'Reason', value: reason }],
					message.author
				);

				embed.description = t('cmd.softBan.done');
			} catch (error) {
				embed.description = t('cmd.softBan.error', { error });
			}
		} else {
			embed.description = t('cmd.ban.canNotSoftBan');
		}

		const response = await this.sendReply(message, embed);
		if (response && settings.modPunishmentSoftbanDeleteMessage) {
			const func = () => {
				message.delete().catch(() => undefined);
				response.delete().catch(() => undefined);
			};
			setTimeout(func, 4000);
		}
	}
}