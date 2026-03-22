/**
 * =============================================================================
 * Chaimera Broker Gateway — Redis Pub/Sub Signal Bus
 * =============================================================================
 *
 * Provides a typed wrapper around Redis Pub/Sub for lifecycle coordination
 * between the Auth Manager and WebSocket Listener.
 *
 * The SignalBus is used for:
 *   - TokenWatcher → Auth Manager: "TOKEN_EXPIRING, please refresh"
 *   - Auth Manager → Listener: "TOKEN_REFRESHED, new creds available"
 *   - Listener → Auth Manager: "TOKEN_EXPIRED, emergency re-auth needed"
 *
 * Usage:
 *   import { SignalBus } from '../redis/SignalBus';
 *
 *   const bus = new SignalBus();
 *   await bus.subscribe((event, metadata) => {
 *     if (event === 'TOKEN_REFRESHED') { ... }
 *   });
 *   await bus.publish('TOKEN_EXPIRING');
 */

import { getRedisClient, getRedisSubscriber } from './RedisClient';
import { redisChannels, type LifecycleEvent } from '../config/redis';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'SignalBus' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed lifecycle event payload */
export interface LifecyclePayload {
    event: LifecycleEvent;
    brokerId: string;
    timestamp: number;
    [key: string]: unknown;
}

/** Callback invoked when a lifecycle event is received */
export type LifecycleHandler = (event: LifecycleEvent, payload: LifecyclePayload) => void;

// ---------------------------------------------------------------------------
// Signal Bus Class
// ---------------------------------------------------------------------------

export class SignalBus {
    private readonly brokerId: string;
    private readonly channel: string;
    private handlers: LifecycleHandler[] = [];
    private isSubscribed: boolean = false;

    constructor(brokerId?: string) {
        this.brokerId = brokerId || config.brokerId;
        this.channel = redisChannels.lifecycle(this.brokerId);
    }

    /**
     * Subscribe to lifecycle events on this broker's channel.
     * Multiple handlers can be registered — all are called for each event.
     *
     * Uses the dedicated subscriber Redis connection (cannot be shared
     * with data operations).
     */
    async subscribe(handler: LifecycleHandler): Promise<void> {
        this.handlers.push(handler);

        if (!this.isSubscribed) {
            const subscriber = getRedisSubscriber();

            subscriber.on('message', (channel: string, message: string) => {
                if (channel !== this.channel) return;

                try {
                    const payload = JSON.parse(message) as LifecyclePayload;

                    log.debug({ event: payload.event, channel }, 'Received lifecycle event');

                    for (const h of this.handlers) {
                        try {
                            h(payload.event, payload);
                        } catch (handlerError) {
                            log.error(
                                { error: (handlerError as Error).message, event: payload.event },
                                'Lifecycle handler threw an error'
                            );
                        }
                    }
                } catch (parseError) {
                    log.error(
                        { error: (parseError as Error).message, rawMessage: message },
                        'Failed to parse lifecycle event payload'
                    );
                }
            });

            await subscriber.subscribe(this.channel);
            this.isSubscribed = true;
            log.info({ channel: this.channel }, 'Subscribed to lifecycle channel');
        }
    }

    /**
     * Publish a lifecycle event to the broker's channel.
     * Uses the data Redis connection (not the subscriber connection).
     */
    async publish(
        event: LifecycleEvent,
        metadata?: Record<string, unknown>
    ): Promise<void> {
        const redis = getRedisClient();

        const payload: LifecyclePayload = {
            event,
            brokerId: this.brokerId,
            timestamp: Date.now(),
            ...metadata,
        };

        const subscriberCount = await redis.publish(this.channel, JSON.stringify(payload));

        log.info(
            { event, channel: this.channel, subscribers: subscriberCount },
            'Published lifecycle event'
        );
    }

    /**
     * Remove all handlers and unsubscribe from the channel.
     */
    async unsubscribe(): Promise<void> {
        if (this.isSubscribed) {
            const subscriber = getRedisSubscriber();
            await subscriber.unsubscribe(this.channel);
            this.isSubscribed = false;
            this.handlers = [];
            log.info({ channel: this.channel }, 'Unsubscribed from lifecycle channel');
        }
    }
}
