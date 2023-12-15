import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda';
import opentelemetry from '@opentelemetry/api';

import AWS from 'aws-sdk';

const s3 = new AWS.S3();

exports.handler = async (event: APIGatewayProxyEvent, context: Context) => {
  console.info('Serving lambda request.');

  const result = await s3.listBuckets().promise();
  const myMeter = opentelemetry.metrics.getMeter('my-service-meter');
  const counter = myMeter.createCounter('events.counter');
  counter.add(1);

  const response: APIGatewayProxyResult = {
    statusCode: 200,
    body: `Hello lambda - found ${result.Buckets?.length || 0} buckets`,
  };
  return response;
};
