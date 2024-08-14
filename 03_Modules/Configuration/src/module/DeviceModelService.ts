// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

import {
  AttributeEnumType,
  IMessageConfirmation,
  MutabilityEnumType,
  SetVariableDataType,
  SetVariablesResponse,
  SetVariableStatusEnumType,
} from '@citrineos/base';
import { IDeviceModelRepository, VariableAttribute } from '@citrineos/data';
import { v4 as uuidv4 } from 'uuid';

export class DeviceModelService {
  protected _deviceModelRepository: IDeviceModelRepository;

  constructor(deviceModelRepository: IDeviceModelRepository) {
    this._deviceModelRepository = deviceModelRepository;
  }

  /**
   * Fetches the ItemsPerMessageSetVariables attribute from the device model.
   * Returns null if no such attribute exists.
   * It is possible for there to be multiple ItemsPerMessageSetVariables attributes if component instances or evses
   * are associated with alternate options. That structure is not supported by this logic, and that
   * structure is a violation of Part 2 - Specification of OCPP 2.0.1.
   * In that case, the first attribute will be returned.
   * @param stationId Charging station identifier.
   * @returns ItemsPerMessageSetVariables as a number or null if no such attribute exists.
   */
  async getItemsPerMessageSetVariablesByStationId(
    stationId: string,
  ): Promise<number | null> {
    const itemsPerMessageSetVariablesAttributes: VariableAttribute[] =
      await this._deviceModelRepository.readAllByQuerystring({
        stationId: stationId,
        component_name: 'DeviceDataCtrlr',
        variable_name: 'ItemsPerMessage',
        variable_instance: 'SetVariables',
        type: AttributeEnumType.Actual,
      });
    if (itemsPerMessageSetVariablesAttributes.length === 0) {
      return null;
    } else {
      // It is possible for itemsPerMessageSetVariablesAttributes.length > 1 if component instances or evses
      // are associated with alternate options. That structure is not supported by this logic, and that
      // structure is a violation of Part 2 - Specification of OCPP 2.0.1.
      return Number(itemsPerMessageSetVariablesAttributes[0].value);
    }
  }

  /**
   * Fetches the ItemsPerMessageGetVariables attribute from the device model.
   * Returns null if no such attribute exists.
   * It is possible for there to be multiple ItemsPerMessageGetVariables attributes if component instances or evses
   * are associated with alternate options. That structure is not supported by this logic, and that
   * structure is a violation of Part 2 - Specification of OCPP 2.0.1.
   * In that case, the first attribute will be returned.
   * @param stationId Charging station identifier.
   * @returns ItemsPerMessageGetVariables as a number or null if no such attribute exists.
   */
  async getItemsPerMessageGetVariablesByStationId(
    stationId: string,
  ): Promise<number | null> {
    const itemsPerMessageGetVariablesAttributes: VariableAttribute[] =
      await this._deviceModelRepository.readAllByQuerystring({
        stationId: stationId,
        component_name: 'DeviceDataCtrlr',
        variable_name: 'ItemsPerMessage',
        variable_instance: 'GetVariables',
        type: AttributeEnumType.Actual,
      });
    if (itemsPerMessageGetVariablesAttributes.length === 0) {
      return null;
    } else {
      // It is possible for itemsPerMessageGetVariablesAttributes.length > 1 if component instances or evses
      // are associated with alternate options. That structure is not supported by this logic, and that
      // structure is a violation of Part 2 - Specification of OCPP 2.0.1.
      return Number(itemsPerMessageGetVariablesAttributes[0].value);
    }
  }

  async updateDeviceModel(
    chargingStation: any,
    stationId: string,
    timestamp: string,
  ): Promise<void> {
    const attributes = [
      {
        component: 'ChargingStation',
        variable: 'Model',
        value: chargingStation.model,
      },
      {
        component: 'ChargingStation',
        variable: 'VendorName',
        value: chargingStation.vendorName,
      },
      {
        component: 'Controller',
        variable: 'FirmwareVersion',
        value: chargingStation.firmwareVersion,
      },
      {
        component: 'ChargingStation',
        variable: 'SerialNumber',
        value: chargingStation.serialNumber,
      },
      {
        component: 'DataLink',
        variable: 'IMSI',
        value: chargingStation.modem?.imsi,
      },
      {
        component: 'DataLink',
        variable: 'ICCID',
        value: chargingStation.modem?.iccid,
      },
    ];

    const promises = attributes
      .filter((attr) => attr.value !== undefined)
      .map((attr) =>
        this._deviceModelRepository.createOrUpdateDeviceModelByStationId(
          {
            component: { name: attr.component },
            variable: { name: attr.variable },
            variableAttribute: [
              {
                type: AttributeEnumType.Actual,
                value: attr.value,
                mutability: MutabilityEnumType.ReadOnly,
                persistent: true,
                constant: true,
              },
            ],
          },
          stationId,
          timestamp,
        ),
      );

    await Promise.all(promises);
  }

  async executeSetVariablesAfterBoot(
    stationId: string,
    cacheCallback: (correlationId: string) => Promise<string | null>,
    sendSetVariableRequest: (
      correlationId: string,
      data: SetVariableDataType[],
      itemsPerMessageSetVariables: number,
    ) => Promise<IMessageConfirmation>,
  ): Promise<[boolean, boolean]> {
    let rejectedSetVariable = false;
    let rebootSetVariable = false;
    let setVariableData: SetVariableDataType[] =
      await this._deviceModelRepository.readAllSetVariableByStationId(
        stationId,
      );

    // If ItemsPerMessageSetVariables not set, send all variables at once
    const itemsPerMessageSetVariables =
      (await this.getItemsPerMessageSetVariablesByStationId(stationId)) ??
      setVariableData.length;

    while (setVariableData.length > 0) {
      const correlationId = uuidv4();

      await sendSetVariableRequest(
        correlationId,
        setVariableData,
        itemsPerMessageSetVariables,
      );

      setVariableData = setVariableData.slice(itemsPerMessageSetVariables);

      const setVariablesResponseJsonString = await cacheCallback(correlationId);

      if (setVariablesResponseJsonString) {
        if (rejectedSetVariable && rebootSetVariable) {
          continue;
        }

        const setVariablesResponse: SetVariablesResponse = JSON.parse(
          setVariablesResponseJsonString,
        );
        setVariablesResponse.setVariableResult.forEach((result) => {
          if (result.attributeStatus === SetVariableStatusEnumType.Rejected) {
            rejectedSetVariable = true;
          } else if (
            result.attributeStatus === SetVariableStatusEnumType.RebootRequired
          ) {
            rebootSetVariable = true;
          }
        });
      } else {
        throw new Error('SetVariables response not found');
      }
    }

    return [rejectedSetVariable, rebootSetVariable];
  }
}
