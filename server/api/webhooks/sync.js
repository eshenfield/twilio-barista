const {
  SYNC_NAMES,
  customersMap,
  orderQueueList,
  restClient,
  sendMessage,
  deregisterOpenOrder,
} = require('../twilio');

const {
  getOrderCancelledMessage,
  getOrderReadyMessage,
} = require('../../utils/messages');

const { setGlobalConfig, setEventConfig } = require('../../data/config');

async function handleOrderStatusChange(requestBody) {
  const itemData = JSON.parse(requestBody.ItemData);
  const eventId = requestBody.ListUniqueName.replace(
    SYNC_NAMES.ORDER_QUEUE,
    ''
  );
  const itemIndex = +requestBody.ItemIndex;
  if (itemData.status === 'open') {
    return;
  }

  const customer = await customersMap.syncMapItems(itemData.customer).fetch();
  const indexOfOrder = customer.data.openOrders.indexOf(itemIndex);
  customer.data.openOrders.splice(indexOfOrder, 1);
  await customersMap.syncMapItems(customer.key).update({
    data: customer.data,
  });

  let responseMessage;
  if (itemData.status === 'ready') {
    responseMessage = getOrderReadyMessage(itemData.product, itemIndex, eventId);
  } else {
    responseMessage = getOrderCancelledMessage(itemData.product, itemIndex);
  }
  await sendMessage(customer.key, responseMessage);

  await orderQueueList(eventId)
    .syncListItems(itemIndex)
    .remove();
  const newBindingSid = await deregisterOpenOrder(customer.data.bindingSid);
  const newCustomerData = Object.assign({}, customer.data, {
    bindingSid: newBindingSid,
  });
  await customer.update({ data: newCustomerData });
}

function validEventType(eventType) {
  return eventType === 'list_item_updated' || isDocumentUpdate(eventType);
}

function isDocumentUpdate(eventType) {
  return eventType === 'document_created' || eventType === 'document_updated';
}

function updateConfiguration(requestBody) {
  const newConfig = JSON.parse(requestBody.DocumentData);
  setGlobalConfig(newConfig);
}

function updateEventConfiguration(requestBody) {
  const newConfig = JSON.parse(requestBody.DocumentData);
  setEventConfig(newConfig);
}

async function handler(req, res, next) {
  res.sendStatus(200);
  if (!req.body || !req.body.EventType || !validEventType(req.body.EventType)) {
    return;
  }

  try {
    if (isDocumentUpdate(req.body.EventType)) {
      if (req.body.DocumentUniqueName === SYNC_NAMES.CONFIGURATION) {
        updateConfiguration(req.body);
      } else {
        updateEventConfiguration(req.body);
      }
    } else {
      if (!req.body.ListUniqueName.startsWith(SYNC_NAMES.ORDER_QUEUE)) {
        return;
      }

      await handleOrderStatusChange(req.body);
    }
  } catch (err) {
    req.log.error(err);
  }
}

module.exports = { handler };
