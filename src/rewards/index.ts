import util = require('util');

import db = require('../database');
import plugins = require('../plugins');

type Params = {
    uid: string;
    condition: string;
    method: () => unknown;
};

type Reward = {
    id: string;
    rid: string;
    claimable: string;
    conditional: string;
    score: string;
    value: number;
}

type RewardsIndexModule = {
    checkConditionAndRewardUser: (params: Params) => Promise<void>;
};

const rewards: RewardsIndexModule = module.exports as RewardsIndexModule;

async function isConditionActive(condition: string): Promise<boolean> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return await db.isSetMember('conditions:active', condition) as boolean;
}

async function getIDsByCondition(condition: string): Promise<string[]> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return await db.getSetMembers(`condition:${condition}:rewards`) as string[];
}

async function filterCompletedRewards(uid: string, rewards: Reward[]): Promise<Reward[]> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const data = await db.getSortedSetRangeByScoreWithScores(`uid:${uid}:rewards`, 0, -1, 1, '+inf') as Reward[];
    const userRewards = {};

    data.forEach((obj) => {
        userRewards[obj.value] = parseInt(obj.score, 10);
    });

    return rewards.filter((reward) => {
        if (!reward) {
            return false;
        }

        const claimable = parseInt(reward.claimable, 10);
        return claimable === 0 || (!userRewards[reward.id] || userRewards[reward.id] < reward.claimable);
    });
}

async function getRewardDataByIDs(ids: string[]): Promise<Reward[]> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return await db.getObjects(ids.map(id => `rewards:id:${id}`)) as Reward[];
}

async function getRewardsByRewardData(rewards: Reward[]): Promise<Reward[]> {
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    return await db.getObjects(rewards.map(reward => `rewards:id:${reward.id}:rewards`)) as Reward[];
}

async function checkCondition(reward: Reward, method: () => unknown): Promise<boolean> {
    if (method.constructor && method.constructor.name !== 'AsyncFunction') {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        method = util.promisify(method);
    }
    const value = await method();
    // The next line calls a function in a module that has not been updated to TS yet
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const bool = await plugins.hooks.fire(`filter:rewards.checkConditional:${reward.conditional}`, { left: value, right: reward.value }) as boolean;
    return bool;
}

async function giveRewards(uid: string, rewards: Reward[]): Promise<void> {
    const rewardData = await getRewardsByRewardData(rewards);
    for (let i = 0; i < rewards.length; i++) {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        /* eslint-disable no-await-in-loop */
        await plugins.hooks.fire(`action:rewards.award:${rewards[i].rid}`, { uid: uid, reward: rewardData[i] });
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetIncrBy(`uid:${uid}:rewards`, 1, rewards[i].id);
    }
}

rewards.checkConditionAndRewardUser = async function (params: Params): Promise<void> {
    const { uid, condition, method } = params;
    const isActive = await isConditionActive(condition);
    if (!isActive) {
        return;
    }
    const ids = await getIDsByCondition(condition);
    let rewardData = await getRewardDataByIDs(ids);
    rewardData = await filterCompletedRewards(uid, rewardData);
    rewardData = rewardData.filter(Boolean);
    if (!rewardData || !rewardData.length) {
        return;
    }
    const eligible = await Promise.all(rewardData.map(reward => checkCondition(reward, method)));
    const eligibleRewards = rewardData.filter((reward, index) => eligible[index]);
    await giveRewards(uid, eligibleRewards);
};
