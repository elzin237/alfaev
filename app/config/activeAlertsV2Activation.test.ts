import { describe,expect,it } from 'vitest';
import { ACTIVE_ALERTS_V2_RELEASE,activeAlertsV2EnabledFor } from './activeAlertsV2Activation';
describe('Active Alerts v2 release boundary',()=>{
  it('enables only the reviewed DEV backend through migration 186',()=>{
    expect(Object.isFrozen(ACTIVE_ALERTS_V2_RELEASE)).toBe(true);expect(ACTIVE_ALERTS_V2_RELEASE.enabled).toBe(true);
    expect(ACTIVE_ALERTS_V2_RELEASE.requiredMigration).toBe('20261031130000');expect(ACTIVE_ALERTS_V2_RELEASE.verifiedMigration).toBe(ACTIVE_ALERTS_V2_RELEASE.requiredMigration);
    expect(activeAlertsV2EnabledFor(ACTIVE_ALERTS_V2_RELEASE.backendOrigin)).toBe(true);
    expect(activeAlertsV2EnabledFor(ACTIVE_ALERTS_V2_RELEASE.backendOrigin,{...ACTIVE_ALERTS_V2_RELEASE,enabled:false})).toBe(false);
  });
  it('cannot enable production, alternate origins or an unverified backend',()=>{
    const enabled={...ACTIVE_ALERTS_V2_RELEASE,enabled:true,verifiedMigration:ACTIVE_ALERTS_V2_RELEASE.requiredMigration};
    expect(activeAlertsV2EnabledFor(enabled.backendOrigin,enabled)).toBe(true);
    expect(activeAlertsV2EnabledFor('https://production.invalid',enabled)).toBe(false);
    expect(activeAlertsV2EnabledFor('invalid-url',enabled)).toBe(false);
    expect(activeAlertsV2EnabledFor(enabled.backendOrigin,{...enabled,verifiedMigration:'20261031120000'})).toBe(false);
    expect(activeAlertsV2EnabledFor(enabled.backendOrigin,{...enabled,requiredMigration:'20261031120000',verifiedMigration:'20261031120000'})).toBe(false);
    expect(activeAlertsV2EnabledFor('https://production.invalid',{...enabled,backendOrigin:'https://production.invalid'})).toBe(false);
  });
});
