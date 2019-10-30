import { Embed, Guild, Member, Message, Role, TextChannel } from 'eris';
import moment from 'moment';

import { IMClient } from '../../client';
import { GuildSettingsKey, RankAssignmentStyle } from '../../models/GuildSetting';
import { JoinInvalidatedReason } from '../../models/Join';
import { Rank } from '../../models/Rank';
import { BasicInvite, BasicMember, GuildPermission } from '../../types';

export interface LeaderboardEntry {
	id: string;
	name: string;
	discriminator: string;
	total: number;
	regular: number;
	custom: number;
	fakes: number;
	leaves: number;
}

export interface JoinLeaveTemplateData {
	invite: BasicInvite;
	inviter: BasicMember;
}

export interface InviteCounts {
	regular: number;
	custom: number;
	fake: number;
	leave: number;
	total: number;
}

export class InvitesService {
	private client: IMClient;

	public constructor(client: IMClient) {
		this.client = client;
	}

	public async getInviteCounts(guildId: string, memberId: string): Promise<InviteCounts> {
		const inviteCodePromise = this.client.repo.inviteCode
			.createQueryBuilder()
			.select('SUM(uses - clearedAmount)', 'total')
			.where('guildId = :guildId AND inviterId = :memberId AND uses > clearedAmount', { guildId, memberId })
			.getRawOne();
		const joinsPromise = this.client.repo.join
			.createQueryBuilder('join')
			.select('COUNT(id)', 'total')
			.select('invalidatedReason', 'invalidatedReason')
			.where('join.guildId = :guildId AND invalidatedReason IS NOT NULL AND cleared = 0', { guildId })
			.leftJoin('join.exactMatch', 'exactMatch')
			.andWhere('exactMatch.inviterId = :memberId', { memberId })
			.getRawMany();
		const customInvitesPromise = this.client.repo.customInvite
			.createQueryBuilder()
			.select('SUM(amount)', 'total')
			.where('guildId = :guildId AND memberId = :memberId AND cleared = 0', { guildId, memberId })
			.getRawOne();

		const [invCode, js, customInvs] = await Promise.all([inviteCodePromise, joinsPromise, customInvitesPromise]);

		const regular = Number(invCode.total);
		const custom = Number(customInvs.total);

		let fake = 0;
		let leave = 0;
		js.forEach((j: any) => {
			if (j.invalidatedReason === JoinInvalidatedReason.fake) {
				fake -= Number(j.total);
			} else if (j.invalidatedReason === JoinInvalidatedReason.leave) {
				leave -= Number(j.total);
			}
		});

		return {
			regular,
			custom,
			fake,
			leave,
			total: regular + custom + fake + leave
		};
	}

	public async generateLeaderboard(guildId: string) {
		const inviteCodePromise = this.client.repo.inviteCode
			.createQueryBuilder('inviteCode')
			.select('SUM(inviteCode.uses - inviteCode.clearedAmount)', 'total')
			.addSelect('inviteCode.inviterId', 'inviterId')
			.addSelect('inviter.name', 'inviterName')
			.addSelect('inviter.discriminator', 'inviterDiscriminator')
			.leftJoin('inviteCode.inviter', 'inviter')
			.where('inviteCode.guildId = :guildId AND inviteCode.uses > inviteCode.clearedAmount', { guildId })
			.groupBy('inviteCode.inviterId')
			.getRawMany();

		const joinsPromise = this.client.repo.join
			.createQueryBuilder('join')
			.select('COUNT(join.id)', 'total')
			.addSelect('exactMatch.inviterId', 'inviterId')
			.addSelect('inviter.name', 'inviterName')
			.addSelect('inviter.discriminator', 'inviterDiscriminator')
			.addSelect('join.invalidatedReason', 'invalidatedReason')
			.leftJoin('join.exactMatch', 'exactMatch')
			.leftJoin('exactMatch.inviter', 'inviter')
			.where('join.guildId = :guildId AND join.invalidatedReason IS NOT NULL AND join.cleared = 0', { guildId })
			.groupBy('exactMatch.inviterId')
			.addGroupBy('join.invalidatedReason')
			.getRawMany();

		const customInvitesPromise = this.client.repo.customInvite
			.createQueryBuilder('customInvite')
			.select('SUM(amount)', 'total')
			.addSelect('customInvite.memberId', 'memberId')
			.addSelect('member.name', 'memberName')
			.addSelect('member.discriminator', 'memberDiscriminator')
			.leftJoin('customInvite.member', 'member')
			.where('customInvite.guildId = :guildId AND customInvite.cleared = 0', { guildId })
			.groupBy('customInvite.memberId')
			.getRawMany();

		const [invCodes, js, customInvs] = await Promise.all([inviteCodePromise, joinsPromise, customInvitesPromise]);

		const entries: Map<string, LeaderboardEntry> = new Map();
		invCodes.forEach(inv => {
			const id = inv.inviterId;
			entries.set(id, {
				id,
				name: inv.inviterName,
				discriminator: inv.inviterDiscriminator,
				total: Number(inv.total),
				regular: Number(inv.total),
				custom: 0,
				fakes: 0,
				leaves: 0
			});
		});

		js.forEach(join => {
			const id = join.inviterId;
			let fake = 0;
			let leave = 0;
			if (join.invalidatedReason === JoinInvalidatedReason.fake) {
				fake += Number(join.total);
			} else {
				leave += Number(join.total);
			}
			const entry = entries.get(id);
			if (entry) {
				entry.total -= fake + leave;
				entry.fakes -= fake;
				entry.leaves -= leave;
			} else {
				entries.set(id, {
					id,
					name: join.inviterName,
					discriminator: join.inviterDiscriminator,
					total: -(fake + leave),
					regular: 0,
					custom: 0,
					fakes: -fake,
					leaves: -leave
				});
			}
		});

		customInvs.forEach(inv => {
			const id = inv.memberId;
			const custom = Number(inv.total);
			const entry = entries.get(id);
			if (entry) {
				entry.total += custom;
				entry.custom += custom;
			} else {
				entries.set(id, {
					id,
					name: inv.memberName,
					discriminator: inv.memberDiscriminator,
					total: custom,
					regular: 0,
					custom: custom,
					fakes: 0,
					leaves: 0
				});
			}
		});

		return [...entries.entries()]
			.filter(([k, entry]) => entry.total > 0)
			.sort(([, a], [, b]) => {
				const diff = b.total - a.total;
				return diff !== 0 ? diff : a.name ? a.name.localeCompare(b.name) : 0;
			})
			.map(([, e]) => e);
	}

	public async fillJoinLeaveTemplate(
		template: string,
		guild: Guild,
		member: Member,
		invites: InviteCounts,
		{ invite, inviter }: JoinLeaveTemplateData
	): Promise<string | Embed> {
		if (typeof template !== 'string') {
			template = JSON.stringify(template);
		}

		let numJoins = 0;
		if (template.indexOf('{numJoins}') >= 0) {
			numJoins = await this.client.repo.join.count({
				where: {
					guildId: guild.id,
					memberId: member.id
				}
			});
		}

		let firstJoin: moment.Moment | string = 'never';
		if (template.indexOf('{firstJoin:') >= 0) {
			const temp = await this.client.repo.join.findOne({
				where: {
					guildId: guild.id,
					memberId: member.id
				},
				order: { createdAt: 'ASC' }
			});
			if (temp) {
				firstJoin = moment(temp.createdAt);
			}
		}

		let prevJoin: moment.Moment | string = 'never';
		if (template.indexOf('{previousJoin:') >= 0) {
			const temp = await this.client.repo.join.find({
				where: {
					guildId: guild.id,
					memberId: member.id
				},
				order: { createdAt: 'DESC' },
				skip: 1,
				take: 1
			});
			if (temp.length > 0) {
				prevJoin = moment(temp[0].createdAt);
			}
		}

		const memberFullName = member.user.username + '#' + member.user.discriminator;
		const inviterFullName = inviter.user.username + '#' + inviter.user.discriminator;

		let memberName = member.nick ? member.nick : member.user.username;
		const encodedMemberName = JSON.stringify(memberName);
		memberName = encodedMemberName.substring(1, encodedMemberName.length - 1);

		let invName = inviter.nick ? inviter.nick : inviter.user.username;
		const encodedInvName = JSON.stringify(invName);
		invName = encodedInvName.substring(1, encodedInvName.length - 1);

		const joinedAt = moment(member.joinedAt);
		const createdAt = moment(member.user.createdAt);

		return this.client.msg.fillTemplate(
			guild,
			template,
			{
				inviteCode: invite.code,
				memberId: member.id,
				memberName: memberName,
				memberFullName: memberFullName,
				memberMention: `<@${member.id}>`,
				memberImage: member.user.avatarURL,
				numJoins: `${numJoins}`,
				inviterId: inviter.user.id,
				inviterName: invName,
				inviterFullName: inviterFullName,
				inviterMention: `<@${inviter.user.id}>`,
				inviterImage: inviter.user.avatarURL,
				numInvites: `${invites.total}`,
				numRegularInvites: `${invites.regular}`,
				numBonusInvites: `${invites.custom}`,
				numFakeInvites: `${invites.fake}`,
				numLeaveInvites: `${invites.leave}`,
				memberCount: `${guild.memberCount}`,
				channelMention: `<#${invite.channel.id}>`,
				channelName: invite.channel.name
			},
			{
				memberCreated: createdAt,
				firstJoin: firstJoin,
				previousJoin: prevJoin,
				joinedAt: joinedAt
			}
		);
	}

	public async promoteIfQualified(guild: Guild, member: Member, me: Member, totalInvites: number) {
		let nextRankName = '';
		let nextRank: Rank = null;

		const settings = await this.client.cache.settings.get(guild.id);
		const style = settings.rankAssignmentStyle;

		const allRanks = await this.client.cache.ranks.get(guild.id);

		// Return early if we don't have any ranks so we do not
		// get any permission issues for MANAGE_ROLES
		if (allRanks.length === 0) {
			return;
		}

		let highest: Role = null;
		let dangerous: Role[] = [];
		let reached: Role[] = [];
		const notReached: Role[] = [];

		allRanks.forEach(r => {
			const role = guild.roles.get(r.roleId);
			if (role) {
				if (r.numInvites <= totalInvites) {
					reached.push(role);
					if (!highest || highest.position < role.position) {
						highest = role;
					}
				} else {
					notReached.push(role);
					// Rank requires more invites
					if (!nextRank || r.numInvites < nextRank.numInvites) {
						// Next rank is the one with lowest invites needed
						nextRank = r;
						nextRankName = role.name;
					}
				}
			} else {
				console.log('ROLE DOES NOT EXIST');
			}
		});

		let myRole: Role;
		me.roles.forEach(r => {
			const role = guild.roles.get(r);
			if (role && (!myRole || myRole.position < role.position)) {
				myRole = role;
			}
		});

		const tooHighRoles = guild.roles.filter(r => r.position > myRole.position);

		let shouldHave: Role[] = [];
		let shouldNotHave = notReached.filter(r => tooHighRoles.includes(r) && member.roles.includes(r.id));

		if (highest && !member.roles.includes(highest.id)) {
			const rankChannelId = settings.rankAnnouncementChannel;
			if (rankChannelId) {
				const rankChannel = guild.channels.get(rankChannelId) as TextChannel;

				// Check if it's a valid channel
				if (rankChannel) {
					const rankMessageFormat = settings.rankAnnouncementMessage;
					if (rankMessageFormat) {
						const msg = await this.client.msg.fillTemplate(guild, rankMessageFormat, {
							memberId: member.id,
							memberName: member.user.username,
							memberFullName: member.user.username + '#' + member.user.discriminator,
							memberMention: `<@${member.id}>`,
							memberImage: member.user.avatarURL,
							rankMention: `<@&${highest.id}>`,
							rankName: highest.name,
							totalInvites: totalInvites.toString()
						});
						rankChannel
							.createMessage(typeof msg === 'string' ? msg : { embed: msg })
							.then((m: Message) => m.addReaction('🎉'))
							.catch(() => undefined);
					}
				} else {
					console.error(`Guild ${guild.id} has invalid ` + `rank announcement channel ${rankChannelId}`);
					await this.client.cache.settings.setOne(guild.id, GuildSettingsKey.rankAnnouncementChannel, null);
				}
			}
		}

		if (me.permission.has(GuildPermission.MANAGE_ROLES)) {
			// No matter what the rank assignment style is
			// we always want to remove any roles that we don't have
			notReached
				.filter(r => !tooHighRoles.includes(r) && member.roles.includes(r.id))
				.forEach(r =>
					this.client
						.removeGuildMemberRole(guild.id, member.id, r.id, 'Not have enough invites for rank')
						.catch(() => undefined)
				);

			// Filter dangerous roles
			dangerous = reached.filter(
				r => r.permissions.has(GuildPermission.ADMINISTRATOR) || r.permissions.has(GuildPermission.MANAGE_GUILD)
			);
			reached = reached.filter(r => dangerous.indexOf(r) === -1);

			if (style === RankAssignmentStyle.all) {
				// Add all roles that we've reached to the member
				const newRoles = reached.filter(r => !member.roles.includes(r.id));
				// Roles that the member should have but we can't assign
				shouldHave = newRoles.filter(r => tooHighRoles.includes(r));
				// Assign only the roles that we can assign
				newRoles
					.filter(r => !tooHighRoles.includes(r))
					.forEach(r =>
						this.client
							.addGuildMemberRole(guild.id, member.user.id, r.id, 'Reached a new rank by invites')
							.catch(() => undefined)
					);
			} else if (style === RankAssignmentStyle.highest) {
				// Only add the highest role we've reached to the member
				// Remove roles that we've reached but aren't the highest
				const oldRoles = reached.filter(r => r !== highest && member.roles.includes(r.id));
				// Add more roles that we shouldn't have
				shouldNotHave = shouldNotHave.concat(oldRoles.filter(r => tooHighRoles.includes(r)));
				// Remove the old ones from the member
				oldRoles
					.filter(r => !tooHighRoles.includes(r))
					.forEach(r =>
						this.client
							.removeGuildMemberRole(guild.id, member.id, r.id, 'Only keeping highest rank')
							.catch(() => undefined)
					);
				// Add the highest one if we don't have it yet
				if (highest && !member.roles.includes(highest.id)) {
					if (!tooHighRoles.includes(highest)) {
						this.client
							.addGuildMemberRole(guild.id, member.id, highest.id, 'Reached a new rank by invites')
							.catch(() => undefined);
					} else {
						shouldHave = [highest];
					}
				}
			}
		} else {
			// TODO: Notify user about the fact that he deserves a promotion, but it
			// cannot be given to him because of missing permissions
		}

		return {
			numRanks: allRanks.length,
			nextRank,
			nextRankName,
			shouldHave,
			shouldNotHave,
			dangerous
		};
	}
}