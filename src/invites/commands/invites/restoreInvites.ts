import { Message } from 'eris';
import { In, IsNull, Not } from 'typeorm';

import { IMClient } from '../../../client';
import { Command, Context } from '../../../framework/commands/Command';
import { UserResolver } from '../../../framework/resolvers';
import { LogAction } from '../../../models/Log';
import { BasicUser, CommandGroup, InvitesCommand } from '../../../types';

export default class extends Command {
	public constructor(client: IMClient) {
		super(client, {
			name: InvitesCommand.restoreInvites,
			aliases: ['restore-invites', 'unclear-invites', 'unclearInvites'],
			args: [
				{
					name: 'user',
					resolver: UserResolver
				}
			],
			group: CommandGroup.Invites,
			guildOnly: true,
			defaultAdminOnly: true,
			extraExamples: ['!restoreInvites @User', '!restoreInvites "User with space"']
		});
	}

	public async action(message: Message, [user]: [BasicUser], flags: {}, { guild, t }: Context): Promise<any> {
		const memberId = user ? user.id : null;

		await this.client.repo.inviteCode.update(
			{
				guildId: guild.id,
				inviterId: memberId ? memberId : Not(IsNull())
			},
			{
				clearedAmount: 0
			}
		);

		const codes = memberId
			? await this.client.repo.inviteCode.find({ where: { guildId: guild.id, inviterId: memberId } })
			: [];

		await this.client.repo.join.update(
			{
				guildId: guild.id,
				...(codes.length > 0 && {
					exactMatchCode: In(codes.map(ic => ic.code))
				})
			},
			{
				cleared: false
			}
		);

		await this.client.repo.customInvite.update(
			{
				guildId: guild.id,
				...(memberId && { memberId })
			},
			{
				cleared: false
			}
		);

		if (memberId) {
			this.client.cache.invites.flushOne(guild.id, memberId);
		} else {
			this.client.cache.invites.flush(guild.id);
		}

		await this.client.logAction(guild, message, LogAction.restoreInvites, {
			...(memberId && { targetId: memberId })
		});

		return this.sendReply(message, t('cmd.restoreInvites.done'));
	}
}