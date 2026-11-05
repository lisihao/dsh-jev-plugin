/** Return the visible direct-user messages belonging to the current turn. */
export function currentTurnUserMessages(session, pending) {
    const events = session.snapshotEvents();
    const lastTurnEnd = events.findLastIndex(event => event.type === 'turn/end');
    const currentIds = new Set();
    for (const event of events.slice(lastTurnEnd + 1)) {
        if (event.type === 'user/message' && event.data.source.kind === 'user')
            currentIds.add(event.data.id);
    }
    const messages = [];
    const seen = new Set();
    for (const message of session.deriveMessages()) {
        if (message.role !== 'user' || message.source.kind !== 'user' || !currentIds.has(message.id) || seen.has(message.id))
            continue;
        messages.push(message);
        seen.add(message.id);
    }
    for (const message of pending) {
        if (message.source.kind !== 'user' || seen.has(message.id))
            continue;
        messages.push(message);
        seen.add(message.id);
    }
    return messages;
}
//# sourceMappingURL=instruction-turn.js.map