/**
 * Poll management system for creating, voting on, and tallying polls.
 */

import type { PollDefinition, PollVote, PollResults } from './types.js';

export class PollManager {
  private polls = new Map<string, PollDefinition>();
  private votes = new Map<string, PollVote[]>();
  private closedPolls = new Set<string>();

  /**
   * Create a new poll. Throws if a poll with the same ID already exists.
   */
  createPoll(definition: PollDefinition): PollDefinition {
    if (this.polls.has(definition.id)) {
      throw new Error(`Poll with id "${definition.id}" already exists`);
    }
    if (definition.options.length < 2) {
      throw new Error('A poll must have at least 2 options');
    }

    this.polls.set(definition.id, { ...definition });
    this.votes.set(definition.id, []);
    return definition;
  }

  /**
   * Cast a vote on a poll.
   *
   * @throws If the poll does not exist, is closed, has expired, the
   *         option index is invalid, or the user already voted (when
   *         `allowMultiple` is false).
   */
  vote(pollId: string, senderId: string, optionIndex: number): PollVote {
    const poll = this.polls.get(pollId);
    if (!poll) {
      throw new Error(`Poll "${pollId}" not found`);
    }

    if (this.closedPolls.has(pollId)) {
      throw new Error(`Poll "${pollId}" is closed`);
    }

    if (poll.expiresAt !== undefined && Date.now() > poll.expiresAt) {
      this.closedPolls.add(pollId);
      throw new Error(`Poll "${pollId}" has expired`);
    }

    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      throw new Error(
        `Invalid option index ${optionIndex}. Valid range: 0-${poll.options.length - 1}`,
      );
    }

    const pollVotes = this.votes.get(pollId) ?? [];

    if (!poll.allowMultiple) {
      const existingVote = pollVotes.find((v) => v.senderId === senderId);
      if (existingVote) {
        throw new Error(`User "${senderId}" has already voted on poll "${pollId}"`);
      }
    } else {
      // Even with allowMultiple, prevent voting for the same option twice
      const duplicateVote = pollVotes.find(
        (v) => v.senderId === senderId && v.optionIndex === optionIndex,
      );
      if (duplicateVote) {
        throw new Error(
          `User "${senderId}" has already voted for option ${optionIndex} on poll "${pollId}"`,
        );
      }
    }

    const vote: PollVote = {
      pollId,
      senderId,
      optionIndex,
      timestamp: Date.now(),
    };

    pollVotes.push(vote);
    this.votes.set(pollId, pollVotes);

    return vote;
  }

  /**
   * Close a poll so no more votes are accepted.
   */
  closePoll(pollId: string): void {
    if (!this.polls.has(pollId)) {
      throw new Error(`Poll "${pollId}" not found`);
    }
    this.closedPolls.add(pollId);
  }

  /**
   * Get the current results of a poll.
   */
  getResults(pollId: string): PollResults {
    const poll = this.polls.get(pollId);
    if (!poll) {
      throw new Error(`Poll "${pollId}" not found`);
    }

    const pollVotes = this.votes.get(pollId) ?? [];
    const voteCounts = new Map<number, number>();

    // Initialize all options with 0 votes
    for (let i = 0; i < poll.options.length; i++) {
      voteCounts.set(i, 0);
    }

    // Tally votes
    const uniqueVoters = new Set<string>();
    for (const v of pollVotes) {
      const current = voteCounts.get(v.optionIndex) ?? 0;
      voteCounts.set(v.optionIndex, current + 1);
      uniqueVoters.add(v.senderId);
    }

    return {
      poll,
      votes: voteCounts,
      totalVotes: pollVotes.length,
      voters: uniqueVoters.size,
    };
  }

  /**
   * Format poll results as a human-readable text string.
   */
  formatResults(results: PollResults): string {
    const lines: string[] = [];
    const { poll, votes, totalVotes, voters } = results;
    const maxBarWidth = 20;

    lines.push(`Poll: ${poll.question}`);
    lines.push('─'.repeat(40));

    for (let i = 0; i < poll.options.length; i++) {
      const count = votes.get(i) ?? 0;
      const fraction = totalVotes > 0 ? count / totalVotes : 0;
      const barLength = Math.round(fraction * maxBarWidth);
      const bar = '█'.repeat(barLength) + '░'.repeat(maxBarWidth - barLength);
      const pct = totalVotes > 0 ? Math.round(fraction * 100) : 0;

      lines.push(`  ${i + 1}. ${poll.options[i]}`);
      lines.push(`     ${bar} ${pct}% (${count} vote${count !== 1 ? 's' : ''})`);
    }

    lines.push('─'.repeat(40));
    lines.push(`Total: ${totalVotes} vote${totalVotes !== 1 ? 's' : ''} from ${voters} voter${voters !== 1 ? 's' : ''}`);

    if (this.closedPolls.has(poll.id)) {
      lines.push('[CLOSED]');
    } else if (poll.expiresAt !== undefined) {
      const remaining = poll.expiresAt - Date.now();
      if (remaining > 0) {
        const minutes = Math.ceil(remaining / 60_000);
        lines.push(`Expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`);
      } else {
        lines.push('[EXPIRED]');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get all active (non-closed, non-expired) polls for a given channel.
   */
  getActivePolls(channelId: string): PollDefinition[] {
    const now = Date.now();
    const active: PollDefinition[] = [];

    for (const poll of this.polls.values()) {
      if (poll.channelId !== channelId) continue;
      if (this.closedPolls.has(poll.id)) continue;
      if (poll.expiresAt !== undefined && now > poll.expiresAt) continue;
      active.push(poll);
    }

    return active;
  }
}
