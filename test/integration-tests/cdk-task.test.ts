import { PerformTasksCommand, ValidateTasksCommand, RemoveCommand } from '~commands/index';
import { IIntegrationTestContext, baseBeforeAll, baseAfterAll, profileForIntegrationTests, sleepForTest } from './base-integration-test';
import { readFileSync } from 'fs';
import { ChildProcessUtility } from '~util/child-process-util';
import { GetObjectOutput } from 'aws-sdk/clients/s3';

const basePathForScenario = './test/integration-tests/resources/scenario-cdk-task/';

describe('when calling org-formation perform tasks', () => {
    let context: IIntegrationTestContext;

    let spawnProcessAfterDeploy2Targets: jest.MockContext<any, any>;
    let stateAfterDeploy2Targets: GetObjectOutput;
    let spawnProcessAfterDeploy1Target: jest.MockContext<any, any>;
    let stateAfterDeploy1Target: GetObjectOutput;
    let stateAfterRemoveTask: GetObjectOutput;
    let spawnProcessAfterRemoveTask: jest.MockContext<any, any>;
    let spawnProcessMock: jest.SpyInstance;
    let stateAfterCleanup: GetObjectOutput;
    let spawnProcessAfterCleanup: jest.MockContext<any, any>;

    beforeAll(async () => {
        spawnProcessMock = jest.spyOn(ChildProcessUtility, 'SpawnProcess');
        context = await baseBeforeAll();
        const command = {stateBucketName: context.stateBucketName, stateObject: 'state.json', profile: profileForIntegrationTests, verbose: true, region: 'eu-west-1', performCleanup: true, maxConcurrentStacks: 10, failedStacksTolerance: 0, maxConcurrentTasks: 10, failedTasksTolerance: 0, logicalName: 'default' };

        await context.s3client.createBucket({ Bucket: context.stateBucketName }).promise();
        await sleepForTest(200);
        await context.s3client.upload({ Bucket: command.stateBucketName, Key: command.stateObject, Body: readFileSync(basePathForScenario + 'state.json') }).promise();

        await ValidateTasksCommand.Perform({...command, tasksFile: basePathForScenario + '1-deploy-cdk-workload-2targets.yml' })

        spawnProcessMock.mockReset();
        await PerformTasksCommand.Perform({...command, tasksFile: basePathForScenario + '1-deploy-cdk-workload-2targets.yml' });
        spawnProcessAfterDeploy2Targets = spawnProcessMock.mock;
        stateAfterDeploy2Targets = await context.s3client.getObject({Bucket: command.stateBucketName, Key: command.stateObject}).promise();

        spawnProcessMock.mockReset();
        await PerformTasksCommand.Perform({...command, tasksFile: basePathForScenario + '2-deploy-cdk-workload-1target.yml' })
        spawnProcessAfterDeploy1Target = spawnProcessMock.mock;
        stateAfterDeploy1Target = await context.s3client.getObject({Bucket: command.stateBucketName, Key: command.stateObject}).promise();

        spawnProcessMock.mockReset();
        await PerformTasksCommand.Perform({...command, tasksFile: basePathForScenario + '3-remove-cdk-workload-task.yml', performCleanup: false })
        spawnProcessAfterRemoveTask = spawnProcessMock.mock;
        stateAfterRemoveTask = await context.s3client.getObject({Bucket: command.stateBucketName, Key: command.stateObject}).promise();

        spawnProcessMock.mockReset();
        await RemoveCommand.Perform({...command, type: 'cdk', name: 'CdkWorkload' });
        spawnProcessAfterCleanup = spawnProcessMock.mock;
        stateAfterCleanup = await context.s3client.getObject({Bucket: command.stateBucketName, Key: command.stateObject}).promise();
    });

    test('after deploy 2 targets npm ci was called twice', () => {
        expect(spawnProcessAfterDeploy2Targets.calls[0][0]).toEqual(expect.stringContaining('npm i'));
        expect(spawnProcessAfterDeploy2Targets.calls[1][0]).toEqual(expect.stringContaining('npm i'));
    });

    test('after deploy 2 targets npx sls deploy was called twice', () => {
        expect(spawnProcessAfterDeploy2Targets.calls[0][0]).toEqual(expect.stringContaining('npx cdk deploy'));
        expect(spawnProcessAfterDeploy2Targets.calls[1][0]).toEqual(expect.stringContaining('npx cdk deploy'));
    });

    test('after deploy 2 targets state contains both deployed workload', () => {
        const stateAsString = stateAfterDeploy2Targets.Body.toString();
        const state = JSON.parse(stateAsString);
        expect(state).toBeDefined();
        expect(state.targets).toBeDefined();
        expect(state.targets['cdk']).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']['102625093955']).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']['102625093955']['no-region']).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']['340381375986']).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']['340381375986']['no-region']).toBeDefined();
    });

    // test('after deploy workload state contains tracked task', () => {
    //     const stateAsString = stateAfterDeploy2Targets.Body.toString();
    //     const state = JSON.parse(stateAsString);
    //     expect(state).toBeDefined();
    //     expect(state.trackedTasks).toBeDefined();
    // });

    test('after deploy 1 targets sls remove was called', () => {
        expect(spawnProcessAfterDeploy1Target.calls.length).toBe(1);
        expect(spawnProcessAfterDeploy1Target.calls[0][0]).toEqual(expect.stringContaining('npx cdk destroy'));
    })

    test('after deploy 1 targets state does not contain removed target workload', () => {
        const stateAsString = stateAfterDeploy1Target.Body.toString();
        const state = JSON.parse(stateAsString);
        expect(state).toBeDefined();
        expect(state.targets).toBeDefined();
        expect(state.targets['cdk']['CdkWorkload']['102625093955']).toBeUndefined();
    });

    test('after removing task sls remove was not called', () => {
        expect(spawnProcessAfterRemoveTask.calls.length).toBe(0);
    })

    test('after removing task state does contain removed target workload', () => {
        const stateAsString = stateAfterRemoveTask.Body.toString();
        const state = JSON.parse(stateAsString);
        expect(state).toBeDefined();
        expect(state.targets).toBeDefined();
        expect(state.targets['cdk']).toBeDefined();
    });

    test('after cleanup cdk destroy was called', () => {
        expect(spawnProcessAfterCleanup.calls.length).toBe(1);
        expect(spawnProcessAfterCleanup.calls[0][0]).toEqual(expect.stringContaining('npx cdk destroy'));
    })

    test('after cleanup state does not contain removed target workload', () => {
        const stateAsString = stateAfterCleanup.Body.toString();
        const state = JSON.parse(stateAsString);
        expect(state).toBeDefined();
        expect(state.targets).toBeDefined();
        expect(state.targets['cdk']).toBeUndefined();
    });


    afterAll(async () => {
        await baseAfterAll(context);
    });
});